import { buildDocKey, getConfig, resolveTransferProfile, saveConfig, usesDiskRef, usesVfsSnapshot, type EditorType } from "./config";
import {
  ensureDocumentContext,
  isContextBoundToDocument,
  isDocumentDirty,
  type DocumentContextState,
} from "./transfer/context-sync";
import { prepareOutbound } from "./transfer";
import { captureDiskDocumentIdFromEnvironment, resolveDiskRefContext } from "./transfer/disk-ref";
import { PLUGIN_VERSION } from "./version";
import {
  clearDocumentContext,
  clearSessionForDoc,
} from "./context/registry";
import {
  EaiClient,
  getStoredUserId,
  saveUser,
} from "./eai/client";
import { loadCatalog, type CatalogResult } from "./eai/catalog";
import {
  createSession,
  getHistoryMessages,
  isAwaitingCompareReport,
  isCompareTurnRequest,
  isSessionNotFoundError,
  resolveAssistantWaitTimeoutMs,
  sendMessage,
  waitForAssistantTurn,
  type HistoryMessage,
} from "./eai/session";
import { extractWidgetPayload } from "./eai/widget";
import { isVfsNotFoundError, isVfsFileReady } from "./eai/vfs";
import { getSelectedText } from "./editor/reader";
import { renderAuthView } from "./ui/auth";
import { renderShellView } from "./ui/shell";
import { historyToChatMessages } from "./ui/chat-history";
import { createActionHandlers, renderChatView, resetChatScroll, unmountChatView, type ChatMessage } from "./ui/chat";

type AppScreen = "auth" | "shell" | "chat";

class LadcraftR7App {
  private client = new EaiClient();
  private root: HTMLElement;
  private screen: AppScreen = "auth";
  private editorType: EditorType = "word";
  private sessionId: string | null = null;
  private contextFileId: string | null = null;
  private contextFileName: string | null = null;
  private contextFilePath: string | null = null;
  private contextState: DocumentContextState = "no_vfs";
  private contextError: string | null = null;
  private firstMessageInSession = true;
  private messages: ChatMessage[] = [];
  private rawHistory: HistoryMessage[] = [];
  private isSending = false;
  private chatReady = false;
  private catalog: CatalogResult | null = null;
  private shellLoading = false;
  private connectionOk = false;
  private connectionStatus = "";
  private selectedAgentId = "";
  private agentLabel = "";
  private chatStatus = "Готово";
  private needsEditorRemount = false;
  private lastEditorAttachFileId: string | null = null;
  private boundDocKey: string | null = null;
  private historySyncTimer: ReturnType<typeof setInterval> | null = null;
  private widgetPollTimer: ReturnType<typeof setInterval> | null = null;
  private lastChatPaintKey = "";
  private sessionAgentId: string | null = null;

  constructor(root: HTMLElement) {
    this.root = root;
  }

  /** Initialize plugin after Asc.plugin.init. */
  async start(): Promise<void> {
    captureDiskDocumentIdFromEnvironment();
    this.editorType = this.detectEditorType();
    const cfg = getConfig();
    this.selectedAgentId = cfg.selectedAgentId;

    if (this.client.isAuthenticated()) {
      await this.showShell();
    } else {
      this.showAuth();
    }
    this.setupContextMenu();
  }

  private detectEditorType(): EditorType {
    const t = window.Asc?.plugin?.info?.editorType;
    return t === "cell" ? "cell" : "word";
  }

  private showAuth(): void {
    this.screen = "auth";
    const cfg = getConfig();
    renderAuthView(
      this.root,
      this.client,
      {
        onLogin: async (email, password) => {
          const user = await this.client.login(email, password);
          saveUser({ ...user, email });
          await this.showShell();
        },
        onSaveBaseUrl: (baseUrl) => {
          this.client.setBaseUrl(baseUrl);
          saveConfig({ baseUrl });
        },
        onPing: () => this.client.pingConnection(),
      },
      { baseUrl: cfg.baseUrl },
    );
  }

  private async showShell(): Promise<void> {
    this.screen = "shell";
    this.shellLoading = true;
    this.renderShell();

    const ping = await this.client.pingConnection();
    this.connectionOk = ping.ok;
    this.connectionStatus = ping.message;

    try {
      this.catalog = await loadCatalog(this.client);
    } catch (err) {
      this.catalog = {
        agents: [],
        errors: [err instanceof Error ? err.message : String(err)],
      };
    }

    this.shellLoading = false;
    this.renderShell();
  }

  private renderShell(): void {
    renderShellView(
      this.root,
      {
        connectionStatus: this.connectionStatus || "",
        connectionOk: this.connectionOk,
        catalog: this.catalog,
        selectedAgentId: this.selectedAgentId,
        isLoading: this.shellLoading,
        pluginVersion: PLUGIN_VERSION,
      },
      {
        onRefresh: () => this.showShell(),
        onSelectAgent: (agentId) => {
          void this.selectAgent(agentId);
        },
        onOpenChat: () => void this.openChat(),
        onLogout: () => this.logout(),
      },
    );
  }

  private currentDocKey(): string {
    return buildDocKey({
      ...(window.Asc?.plugin?.info ?? {}),
      editorType: this.editorType,
    });
  }

  /** Sync document to session VFS (block 1). */
  private currentTransferProfile(): ReturnType<typeof resolveTransferProfile> {
    const agentId = this.selectedAgentId || getConfig().selectedAgentId;
    return resolveTransferProfile(agentId, this.agentLabel);
  }

  /** disk-ref: bind r7-disk:{document_id} without VFS upload. */
  private applyDiskRefContext(): string {
    const ctx = resolveDiskRefContext(window.Asc?.plugin?.info ?? {});
    this.contextState = "synced";
    this.contextError = null;
    this.contextFileId = ctx.fileId;
    this.contextFileName = ctx.fileName;
    this.boundDocKey = null;
    return ctx.status;
  }

  private async syncDocumentContextForChat(options?: {
    forceReupload?: boolean;
  }): Promise<void> {
    if (!usesVfsSnapshot(this.currentTransferProfile())) {
      if (usesDiskRef(this.currentTransferProfile())) {
        this.applyDiskRefContext();
      }
      return;
    }

    if (!this.sessionId) {
      throw new Error("Нет активной сессии агента");
    }
    const docKey = this.currentDocKey();
    const docSwitched =
      this.boundDocKey != null && this.boundDocKey !== docKey;
    const ctx = await ensureDocumentContext(this.client, this.editorType, {
      sessionId: this.sessionId,
      forceReupload: options?.forceReupload || docSwitched,
      docKey,
    });
    this.applyContext(ctx, docKey);
  }

  /** Agent picked in shell — always end prior chat session before next open. */
  private async selectAgent(agentId: string): Promise<void> {
    if (!agentId) return;
    await this.closeActiveSession();
    this.selectedAgentId = agentId;
    saveConfig({ selectedAgentId: agentId });
    const agent = this.catalog?.agents.find((a) => a.id === agentId);
    this.agentLabel = agent?.name ?? agentId;
    if (this.screen === "shell") {
      this.renderShell();
    }
  }

  private async openChat(): Promise<void> {
    const agentId = this.selectedAgentId || getConfig().selectedAgentId;
    if (!agentId) return;

    resetChatScroll();
    this.screen = "chat";
    this.lastChatPaintKey = "";
    this.needsEditorRemount = true;
    this.selectedAgentId = agentId;
    saveConfig({ selectedAgentId: agentId });

    const agent = this.catalog?.agents.find((a) => a.id === agentId);
    this.agentLabel = agent?.name ?? agentId;

    let status = usesDiskRef(this.currentTransferProfile())
      ? "Готовим контекст диска…"
      : usesVfsSnapshot(this.currentTransferProfile())
        ? "Готовим документ в VFS…"
        : "Открываем чат…";
    this.chatReady = false;
    this.renderChatShell(status);

    try {
      await this.startNewChatSession(agentId);

      if (!this.sessionId) {
        throw new Error("Не удалось создать сессию агента");
      }

      const transferProfile = this.currentTransferProfile();

      if (usesVfsSnapshot(transferProfile)) {
        try {
          await this.syncDocumentContextForChat({ forceReupload: true });
          status = "Документ в VFS";
        } catch (vfsErr) {
          this.clearContext();
          const vfsMsg = vfsErr instanceof Error ? vfsErr.message : String(vfsErr);
          this.contextState = "error";
          this.contextError = vfsMsg;
          status = `Чат без контекста документа (VFS: ${vfsMsg})`;
          this.chatReady = false;
          void this.refreshContextState();
          this.renderChatShell(status);
          return;
        }
      } else if (usesDiskRef(transferProfile)) {
        try {
          status = this.applyDiskRefContext();
        } catch (diskErr) {
          this.contextState = "error";
          this.contextError = diskErr instanceof Error ? diskErr.message : String(diskErr);
          status =
            "Чат открыт — нажмите «Обновить контекст» при смене документа";
        }
      } else {
        status = "Готово";
      }

      await this.syncChatFromServer(agentId);
      this.chatReady = true;
      status = "Готово";
      void this.refreshContextState();
      this.renderChatShell(status);
      this.startHistorySyncPoll(2500);
    } catch (err) {
      this.chatReady = false;
      const msg = err instanceof Error ? err.message : String(err);
      this.showOpenChatError(msg, agentId);
    }
  }

  private showOpenChatError(message: string, agentId: string): void {
    this.root.innerHTML = `<div class="panel"><p class="error">${escapeHtml(message)}</p>
      <div class="toolbar">
        <button class="primary" id="newChatBtn">Создать новый чат</button>
        <button class="secondary" id="backToShell">Назад</button>
      </div></div>`;
    document.getElementById("newChatBtn")?.addEventListener("click", () => {
      void this.closeActiveSession().then(() => this.openChat());
    });
    document.getElementById("backToShell")?.addEventListener("click", () => {
      void this.exitChatToShell(true);
    });
  }

  private buildSessionKey(agentId: string): string {
    const docKey = buildDocKey({
      ...(window.Asc?.plugin?.info ?? {}),
      editorType: this.editorType,
    });
    return `${docKey}::agent:${agentId}`;
  }

  /** Detach locally and create a new Ladcraft session for doc+agent (server session is kept). */
  private async startNewChatSession(agentId: string): Promise<void> {
    await this.closeActiveSession(agentId);
    await this.createFreshSession(agentId);
  }

  /** Detach active session locally; does not DELETE on Ladcraft server. */
  private async closeActiveSession(agentId?: string): Promise<void> {
    this.stopHistorySyncPoll();
    this.stopWidgetPoll();
    this.isSending = false;

    const agentsToClear = new Set<string>();
    if (this.sessionAgentId) agentsToClear.add(this.sessionAgentId);
    if (agentId) agentsToClear.add(agentId);
    const resolvedAgentId =
      agentId ?? (this.selectedAgentId || getConfig().selectedAgentId);
    if (resolvedAgentId) agentsToClear.add(resolvedAgentId);

    const userId = getStoredUserId();
    for (const id of agentsToClear) {
      clearSessionForDoc(userId, this.buildSessionKey(id));
    }
    clearDocumentContext(userId, this.currentDocKey());

    this.sessionId = null;
    this.sessionAgentId = null;
    this.messages = [];
    this.rawHistory = [];
    this.chatReady = false;
    this.firstMessageInSession = true;
    this.lastEditorAttachFileId = null;
    this.boundDocKey = null;
    this.needsEditorRemount = true;
    this.chatStatus = "Готово";
    this.clearContext();
    this.contextError = null;
  }

  /** Plugin panel closed — detach local chat state (server session preserved). */
  async shutdown(): Promise<void> {
    this.stopChatPoll();
    this.stopWidgetPoll();
    this.isSending = false;
    await this.closeActiveSession();
  }

  /** Create a new Ladcraft session for doc+agent (never reuse stored ids). */
  private async createFreshSession(agentId: string): Promise<void> {
    const sessionKey = this.buildSessionKey(agentId);
    clearSessionForDoc(getStoredUserId(), sessionKey);

    const session = await createSession(
      this.client,
      agentId,
      `R7: ${sessionKey.slice(0, 40)}`,
    );
    this.sessionId = session.session_id;
    this.sessionAgentId = agentId;
    this.messages = [];
    this.rawHistory = [];
    this.firstMessageInSession = true;
    this.lastEditorAttachFileId = null;
    this.boundDocKey = null;
    this.needsEditorRemount = true;
  }

  /** Reload message list from Ladcraft session history. */
  private async syncChatFromServer(agentId?: string): Promise<void> {
    if (!this.sessionId) return;
    try {
      await this.loadHistoryFromServer();
    } catch (err) {
      const resolvedAgentId =
        agentId ?? (this.selectedAgentId || getConfig().selectedAgentId);
      if (!resolvedAgentId || !isSessionNotFoundError(err)) throw err;
      await this.recoverStaleSession(resolvedAgentId);
    }
  }

  /** Session expired or deleted server-side — recreate and re-bind VFS. */
  private async recoverStaleSession(
    agentId: string,
    options: { preserveMessages?: boolean } = {},
  ): Promise<void> {
    const preserved = options.preserveMessages ? [...this.messages] : null;
    await this.startNewChatSession(agentId);
    if (preserved) {
      this.messages = preserved;
    }
    if (!usesVfsSnapshot(this.currentTransferProfile())) {
      if (usesDiskRef(this.currentTransferProfile())) {
        try {
          this.applyDiskRefContext();
        } catch {
          /* send path will surface context error */
        }
      }
      this.chatReady = true;
    } else {
      try {
        await this.syncDocumentContextForChat({ forceReupload: true });
        this.chatReady = true;
        this.contextState = "synced";
        this.contextError = null;
      } catch (vfsErr) {
        this.clearContext();
        this.contextState = "error";
        this.contextError = vfsErr instanceof Error ? vfsErr.message : String(vfsErr);
        this.chatReady = false;
      }
    }
    if (!preserved) {
      await this.loadHistoryFromServer();
    }
  }

  private async loadHistoryFromServer(): Promise<void> {
    if (!this.sessionId) return;
    const history = await getHistoryMessages(this.client, this.sessionId);
    this.rawHistory = history;
    this.messages = historyToChatMessages(history, { editorType: this.editorType });
    this.firstMessageInSession = !this.messages.some((m) => m.role === "user");
  }

  private awaitingCompareReport(): boolean {
    return isAwaitingCompareReport(this.rawHistory);
  }

  private renderChatShell(status: string, force = false): void {
    this.chatStatus = status;
    const contextStateBefore = this.contextState;
    const contextErrorBefore = this.contextError;

    const paint = (forcePaint = false): void => {
      const diskRef = usesDiskRef(this.currentTransferProfile());
      const paintKey = [
        status,
        this.historyFingerprint(),
        this.isSending,
        this.chatReady,
        this.contextState,
        this.contextError ?? "",
        this.agentLabel,
      ].join("|");

      if (!forcePaint && paintKey === this.lastChatPaintKey) return;
      this.lastChatPaintKey = paintKey;

      renderChatView(
        this.root,
        {
          messages: this.messages,
          status,
          isSending: this.isSending,
          contextState: this.contextState,
          contextError: this.contextError ?? undefined,
          agentLabel: this.agentLabel,
          chatReady: this.chatReady,
          diskRef,
          pluginVersion: PLUGIN_VERSION,
        },
        {
          onBack: () => {
            void this.exitChatToShell(true);
          },
          onLogout: () => this.logout(),
          onRefreshContext: () => this.handleRefreshContext(),
          onSend: (text) => this.handleSend(text),
          onWidgetSubmit: (text) => this.handleSend(text),
        },
        {
          actionHandlers: createActionHandlers({
            client: this.client,
            editorType: this.editorType,
            onStatus: (msg) => {
              this.chatStatus = msg;
              if (this.screen === "chat") {
                this.renderChatShell(msg);
              }
            },
            onSendMessage: (text) => this.handleSend(text),
          }),
        },
      );
    };

    paint(force);
    void this.refreshContextState().then(() => {
      if (this.screen !== "chat") return;
      if (
        this.contextState !== contextStateBefore ||
        this.contextError !== contextErrorBefore
      ) {
        paint();
      }
    });
    this.syncWidgetPoll();
  }

  /** Poll history while a clarification widget is pending. */
  private syncWidgetPoll(): void {
    this.stopWidgetPoll();
    if (this.screen !== "chat" || !this.sessionId) return;

    const last = this.messages[this.messages.length - 1];
    const needsPoll =
      last?.role === "assistant" &&
      (last.waitingForInput || (last.widget && last.widget.interactive));
    if (!needsPoll) return;

    const agentId = this.selectedAgentId || getConfig().selectedAgentId;
    this.widgetPollTimer = setInterval(() => {
      if (this.screen !== "chat" || !this.sessionId) {
        this.stopWidgetPoll();
        return;
      }
      const before = this.historyFingerprint();
      void this.syncChatFromServer(agentId || undefined).then(() => {
        if (this.screen !== "chat") return;
        if (this.historyFingerprint() !== before) {
          this.renderChatShell(this.chatStatus);
        }
        const latest = this.messages[this.messages.length - 1];
        const stillPending =
          latest?.role === "assistant" &&
          (latest.waitingForInput || (latest.widget && latest.widget.interactive));
        if (!stillPending) this.stopWidgetPoll();
      });
    }, 2000);
  }

  private stopWidgetPoll(): void {
    if (this.widgetPollTimer != null) {
      clearInterval(this.widgetPollTimer);
      this.widgetPollTimer = null;
    }
  }

  /** Leave chat: clear local binding so the next open starts a new server session. */
  private async exitChatToShell(resetSession: boolean): Promise<void> {
    this.stopHistorySyncPoll();
    this.stopWidgetPoll();
    this.isSending = false;
    this.lastChatPaintKey = "";
    unmountChatView(this.root);

    if (resetSession) {
      await this.closeActiveSession();
    }

    await this.showShell();
  }

  /** Poll Ladcraft history while chat is open (survives send timeout). */
  private startHistorySyncPoll(intervalMs = 2500): void {
    this.stopHistorySyncPoll();
    this.historySyncTimer = setInterval(() => {
      void this.tickHistorySync();
    }, intervalMs);
  }

  private stopHistorySyncPoll(): void {
    if (this.historySyncTimer != null) {
      clearInterval(this.historySyncTimer);
      this.historySyncTimer = null;
    }
  }

  private historyFingerprint(): string {
    return this.messages
      .map((m) => `${m.id}:${m.text.length}:${m.widget ? 1 : 0}:${m.widgetChoices?.length ?? 0}`)
      .join("|");
  }

  private hasAssistantReplyForLastUser(): boolean {
    let lastUser = -1;
    for (let i = 0; i < this.messages.length; i++) {
      if (this.messages[i].role === "user") lastUser = i;
    }
    if (lastUser < 0) return false;
    for (let i = lastUser + 1; i < this.messages.length; i++) {
      const m = this.messages[i];
      if (m.role !== "assistant") continue;
      if (m.widget || m.widgetChoices?.length) return true;
      const body = m.text.trim();
      if (body && body !== "Агент выполняет запрос…") return true;
    }
    return false;
  }

  private async tickHistorySync(): Promise<void> {
    if (this.screen !== "chat" || !this.sessionId) {
      this.stopHistorySyncPoll();
      return;
    }

    const agentId = this.selectedAgentId || getConfig().selectedAgentId;
    if (!agentId) return;

    const before = this.historyFingerprint();
    const awaitingLateReply = this.chatStatus === "Ответ задерживается — загружаем из чата…";
    const statusBefore = this.chatStatus;

    try {
      await this.syncChatFromServer(agentId);
    } catch {
      return;
    }

    const changed = this.historyFingerprint() !== before;
    if (this.hasAssistantReplyForLastUser() && awaitingLateReply) {
      this.chatStatus = "Готово";
    } else if (!this.awaitingCompareReport() && this.chatStatus === "Агент выполняет сравнение...") {
      this.chatStatus = "Готово";
    }

    if (changed || this.chatStatus !== statusBefore) {
      this.renderChatShell(this.chatStatus);
      this.syncWidgetPoll();
    }

    if (this.awaitingCompareReport()) {
      this.startHistorySyncPoll(1200);
    } else if (this.historySyncTimer != null) {
      this.startHistorySyncPoll(2500);
    }
  }

  private startChatPoll(): void {
    this.startHistorySyncPoll(1200);
  }

  private stopChatPoll(): void {
    if (!this.isSending && this.screen === "chat") {
      this.startHistorySyncPoll(2500);
      return;
    }
    this.stopHistorySyncPoll();
  }

  private async handleRefreshContext(): Promise<void> {
    if (!this.sessionId) return;
    if (!usesVfsSnapshot(this.currentTransferProfile())) {
      if (!usesDiskRef(this.currentTransferProfile())) return;
      this.contextState = "syncing";
      this.renderChatShell("Обновляем контекст диска...");
      try {
        const status = this.applyDiskRefContext();
        this.chatReady = true;
        this.renderChatShell(status);
      } catch (err) {
        this.contextState = "error";
        this.contextError = err instanceof Error ? err.message : String(err);
        this.chatReady = true;
        this.renderChatShell(`Контекст диска: ${this.contextError}`);
      }
      return;
    }

    const hadError = this.contextState === "error" || Boolean(this.contextError);
    this.contextState = "syncing";
    this.renderChatShell("Синхронизация документа...");
    try {
      await this.syncDocumentContextForChat({ forceReupload: hadError });
      this.contextState = "synced";
      this.contextError = null;
      this.chatReady = true;
      this.renderChatShell("Документ обновлён в VFS");
    } catch (err) {
      this.contextState = "error";
      this.contextError = err instanceof Error ? err.message : String(err);
      this.chatReady = false;
      this.renderChatShell(`Ошибка синхронизации: ${this.contextError}`);
    }
  }

  private applyContext(
    ctx: {
      fileId: string;
      fileName: string;
      filePath?: string;
      contentHash: string;
    },
    docKey: string,
  ): void {
    this.contextFileId = ctx.fileId;
    this.contextFileName = ctx.fileName;
    this.contextFilePath = ctx.filePath ?? null;
    this.boundDocKey = docKey;
    this.contextState = "synced";
    this.contextError = null;
  }

  private clearContext(): void {
    this.contextFileId = null;
    this.contextFileName = null;
    this.contextFilePath = null;
    this.boundDocKey = null;
    this.contextState = "no_vfs";
  }

  private async refreshContextState(): Promise<void> {
    if (usesDiskRef(this.currentTransferProfile())) {
      try {
        const status = this.applyDiskRefContext();
        void status;
      } catch (err) {
        this.contextState = "error";
        this.contextError = err instanceof Error ? err.message : String(err);
      }
      return;
    }

    if (!usesVfsSnapshot(this.currentTransferProfile())) {
      return;
    }

    const docKey = this.currentDocKey();
    if (this.boundDocKey && this.boundDocKey !== docKey) {
      this.contextState = "dirty";
      this.contextError = null;
      return;
    }
    if (!this.contextFileId) {
      this.contextState = "no_vfs";
      return;
    }
    if (this.contextState === "syncing") return;
    try {
      if (
        !isContextBoundToDocument(
          this.editorType,
          this.boundDocKey,
          this.contextFileId,
        )
      ) {
        this.contextState = "dirty";
        return;
      }
      const ready = await isVfsFileReady(this.client, this.contextFileId);
      if (!ready) {
        this.contextState = "error";
        this.contextError = "Файл VFS недоступен — нажмите «Синхр. документ»";
        return;
      }
      const dirty = await isDocumentDirty(this.editorType, {
        docKey: this.boundDocKey,
        fileId: this.contextFileId,
      });
      this.contextState = dirty ? "dirty" : "synced";
      if (!dirty) this.contextError = null;
    } catch (err) {
      this.contextState = "error";
      this.contextError = err instanceof Error ? err.message : String(err);
    }
  }

  private async handleSend(text: string): Promise<void> {
    if (!this.sessionId || this.isSending || !this.chatReady) return;

    const agentId = this.selectedAgentId || getConfig().selectedAgentId;
    if (!agentId) return;

    this.isSending = true;
    this.chatStatus = "Ожидание ответа...";
    const userMsg: ChatMessage = {
      id: `local-${Date.now()}`,
      role: "user",
      text,
    };
    this.messages.push(userMsg);
    this.renderChatShell(this.chatStatus);
    this.startChatPoll();

    try {
      let beforeCount = 0;
      try {
        beforeCount = (await getHistoryMessages(this.client, this.sessionId)).length;
      } catch (err) {
        if (!isSessionNotFoundError(err)) throw err;
        await this.recoverStaleSession(agentId, { preserveMessages: true });
        this.chatStatus = "Создана новая сессия";
        beforeCount = 0;
      }

      try {
        if (usesVfsSnapshot(this.currentTransferProfile())) {
          await this.syncDocumentContextForChat();
        } else if (usesDiskRef(this.currentTransferProfile())) {
          this.applyDiskRefContext();
        }
      } catch (ctxErr) {
        const msg = ctxErr instanceof Error ? ctxErr.message : String(ctxErr);
        console.error("Context sync before send failed:", ctxErr);
        this.clearContext();
        this.contextState = "error";
        this.contextError = msg;
        if (usesVfsSnapshot(this.currentTransferProfile())) {
          throw new Error(
            `Документ не в VFS: ${this.contextError}. Нажмите «Синхр. документ».`,
          );
        }
        if (usesDiskRef(this.currentTransferProfile())) {
          throw new Error(
            `Контекст диска: ${this.contextError}. Нажмите «Обновить контекст».`,
          );
        }
        throw new Error(msg);
      }

      await this.sendUserMessage(text, agentId);
      await this.syncChatFromServer(agentId);

      if (this.firstMessageInSession) {
        this.firstMessageInSession = false;
      }

      if (isCompareTurnRequest(text, this.rawHistory)) {
        this.chatStatus = "Агент выполняет сравнение…";
        this.renderChatShell(this.chatStatus);
      }

      const waitTimeoutMs = resolveAssistantWaitTimeoutMs(text, this.rawHistory);

      const turn = await waitForAssistantTurn(
        this.client,
        this.sessionId,
        beforeCount,
        waitTimeoutMs,
        (progress) => {
          if (this.chatStatus === progress) return;
          this.chatStatus = progress;
          this.renderChatShell(this.chatStatus);
        },
        async () => {
          const before = this.historyFingerprint();
          await this.syncChatFromServer(agentId);
          if (this.historyFingerprint() !== before) {
            this.renderChatShell(this.chatStatus);
          }
        },
      );

      if (!turn) {
        await this.syncChatFromServer(agentId);
        this.chatStatus = "Ответ задерживается — загружаем из чата…";
        this.renderChatShell(this.chatStatus);
        return;
      }

      const widgetPayload =
        extractWidgetPayload(turn.widget ?? turn.reply) ??
        (turn.widget ? extractWidgetPayload(turn.widget) : null);
      const waitingForUser = turn.waitingForUser || Boolean(widgetPayload);

      if (waitingForUser) {
        await this.syncChatFromServer(agentId);
        if (widgetPayload) {
          const assistantMsg = this.messages.find((m) => m.id === turn.reply.id);
          if (assistantMsg && !assistantMsg.widget) {
            assistantMsg.widget = { ...widgetPayload, interactive: true };
          }
        }
        this.chatStatus = widgetPayload
          ? "Выберите вариант в форме"
          : "Ожидание формы или ответьте текстом";
        return;
      }

      await this.syncChatFromServer(agentId);
      this.chatStatus = this.awaitingCompareReport()
        ? "Агент выполняет сравнение..."
        : "Готово";
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.chatStatus = msg;
      if (isVfsNotFoundError(err)) {
        this.contextState = "error";
        this.contextError = msg;
      }
      try {
        await this.syncChatFromServer(agentId);
      } catch {
        /* keep local messages if history fetch fails */
      }
    } finally {
      this.isSending = false;
      this.stopHistorySyncPoll();
      if (this.awaitingCompareReport()) {
        if (this.chatStatus === "Готово") {
          this.chatStatus = "Агент выполняет сравнение...";
        }
        this.startHistorySyncPoll(1200);
      } else {
        this.startHistorySyncPoll(2500);
      }
      this.renderChatShell(this.chatStatus);
    }
  }

  private async sendUserMessage(userText: string, agentId: string): Promise<void> {
    if (!this.sessionId) return;

    const docKey = this.currentDocKey();
    const attachState = {
      firstMessageInSession: this.firstMessageInSession,
      needsEditorRemount: this.needsEditorRemount,
      lastEditorAttachFileId: this.lastEditorAttachFileId,
    };

    const send = async (): Promise<void> => {
      const transferProfile = resolveTransferProfile(agentId, this.agentLabel);
      const { outbound, context } = await prepareOutbound(
        this.client,
        this.editorType,
        userText,
        attachState,
        {
          docKey,
          sessionId: this.sessionId!,
          historyMessages: this.rawHistory,
          transferProfile,
        },
      );
      if (usesVfsSnapshot(transferProfile)) {
        this.applyContext(context, docKey);
      } else if (usesDiskRef(transferProfile)) {
        this.applyDiskRefContext();
      }

      await sendMessage(this.client, this.sessionId!, {
        content: outbound.content,
        fileRefs: outbound.fileRefs,
        attachEditorFile: outbound.attachEditor,
      });

      if (outbound.attachEditor) {
        this.needsEditorRemount = false;
        this.lastEditorAttachFileId = outbound.primaryFileId;
      }
    };

    try {
      await send();
    } catch (err) {
      if (isSessionNotFoundError(err)) {
        await this.recoverStaleSession(agentId, { preserveMessages: true });
        await send();
        return;
      }
      if (!isVfsNotFoundError(err)) throw err;
      clearDocumentContext(getStoredUserId(), docKey);
      await send();
    }
  }

  private async runQuickAction(kind: "rewrite" | "comment"): Promise<void> {
    if (!this.sessionId) return;

    const selected = await getSelectedText();
    let content = "";
    if (kind === "rewrite") {
      if (!selected) return;
      content = `Перепиши выделенный текст:\n\n${selected}`;
    } else {
      content = selected
        ? `Добавь комментарий к выделенному фрагменту:\n\n${selected}`
        : "Добавь комментарий к текущему месту в документе по контексту.";
    }

    await this.handleSend(content);
  }

  private logout(): void {
    void this.shutdown().then(() => {
      this.client.logout();
      this.clearContext();
      this.contextError = null;
      this.catalog = null;
      this.showAuth();
    });
  }

  private setupContextMenu(): void {
    window.Asc.plugin.event_onContextMenuShow = () => {
      if (this.screen !== "chat") return;

      const items = [
        ...(this.editorType === "word"
          ? [
              { id: "ladcraft_rewrite", text: "Ladcraft: переписать выделение" },
              { id: "ladcraft_comment", text: "Ladcraft: добавить комментарий" },
            ]
          : []),
      ];
      if (!items.length) return;

      window.Asc.plugin.executeMethod(
        "AddContextMenuItem",
        [
          {
            guid:
              window.Asc.plugin.guid ??
              window.Asc.plugin.info?.guid ??
              "ladcraft-r7",
            items,
          },
        ],
        () => undefined,
      );
    };

    window.Asc.plugin.event_onContextMenuClick = (id: string) => {
      if (id === "ladcraft_rewrite") void this.runQuickAction("rewrite");
      if (id === "ladcraft_comment") void this.runQuickAction("comment");
    };
  }
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
}

let app: LadcraftR7App | null = null;

window.Asc.plugin.init = function init() {
  captureDiskDocumentIdFromEnvironment();
  const root = document.getElementById("app");
  if (!root) return;
  app = new LadcraftR7App(root);
  void app.start();
};

window.Asc.plugin.onDestroy = function onDestroy() {
  void app?.shutdown();
};

window.Asc.plugin.button = function button() {
  void app?.shutdown();
};

export { LadcraftR7App };
