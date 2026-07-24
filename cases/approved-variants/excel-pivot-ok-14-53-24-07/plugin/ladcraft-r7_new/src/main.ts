import { buildDocKey, getConfig, resolveContextFamily, resolveTransferProfile, saveConfig, usesDiskRef, usesVfsSnapshot, type EditorType } from "./config";
import {
  cleanupSessionDocumentPath,
  ensureDocumentContext,
  isContextBoundToDocument,
  isDocumentDirty,
  type DocumentContextState,
} from "./transfer/context-sync";
import { ensureWorkbookContext } from "./transfer/workbook-context";
import { prepareOutbound } from "./transfer";
import { captureDiskDocumentIdFromEnvironment, resolveDiskRefContext } from "./transfer/disk-ref";
import { STREAMING_WORKING_PLACEHOLDER } from "./apply/content-extract";
import {
  applyEditorTasks,
  collectPendingEditorTasks,
  taskApplyKey,
  taskContentKey,
} from "./apply/task-runner";
import {
  planDedupeHit,
  resolveDocumentApplyPlan,
  MISSING_PROPOSAL_AGENT_NOTE,
  MISSING_PROPOSAL_STATUS,
} from "./apply/intent-apply";
import {
  planFromActionId,
  resolveActionTarget,
  resolveInsertableText,
  type ActionId,
} from "./apply/action-buttons";
import {
  downloadTextAsMarkdown,
  downloadTextAsWordHtml,
  downloadTextAsCsv,
  downloadBlob,
  triggerBrowserDownload,
} from "./apply/local-download";
import {
  deliverableChipLabel,
  listLatestAssistantDeliverables,
  resolveSelectedAgentDeliverable,
} from "./apply/agent-deliverables";
import {
  clearAgentXlsxMatrixCache,
  loadAgentXlsxMatrix,
  matrixToCsv,
  preferredSheetNameFromFile,
} from "./apply/vfs-xlsx-matrix";
import {
  applyMatrixAtActiveCell,
  applyMatrixOnNewSheet,
  applyMatrixReplaceActiveSheet,
  withAction,
} from "./apply/editor-methods";
import {
  wantsNewSheetInOpenWorkbook,
  wantsReplaceOpenSheet,
} from "./apply/spreadsheet-intent";
import { downloadVfsFile, normalizeSessionVfsPath, resolveSessionXlsxFile } from "./eai/vfs";
import { parseR7Proposal } from "./apply/proposal-parse";
import { getSelectedText } from "./editor/reader";
import {
  buildApplyEventPayload,
  feedbackNotifyKey,
  formatR7EventBlock,
} from "./apply/apply-feedback";
import type { R7Task } from "./apply/task-parse";
import { PLUGIN_VERSION } from "./version";
import { applyPanelLayoutClass, getPluginFeatures } from "./features";
import {
  clearDocumentContext,
  clearSessionForDoc,
  getDocumentContext,
  getSessionForDoc,
} from "./context/registry";
import {
  EaiClient,
  getStoredUserId,
  saveUser,
} from "./eai/client";
import { isVfsPathConflictError } from "./eai/vfs";
import { loadCatalog, type CatalogResult } from "./eai/catalog";
import {
  createSession,
  ensureAgentQueueIdleBeforeSend,
  extractApplySourceText,
  finishPreviousAgentSessions,
  getHistoryMessages,
  isAwaitingCompareReport,
  isCompareTurnRequest,
  isSessionNotFoundError,
  resolveAssistantWaitTimeoutMs,
  sendMessage,
  waitForAssistantTurn,
  type HistoryMessage,
} from "./eai/session";
import { createChatTransport } from "./eai/transport";
import { StreamOrchestrator } from "./eai/stream-orchestrator";
import { extractWidgetPayload } from "./eai/widget";
import { isVfsNotFoundError, isVfsFileReady } from "./eai/vfs";
import { renderAuthView } from "./ui/auth";
import { renderShellView } from "./ui/shell";
import { historyToChatMessages } from "./ui/chat-history";
import {
  collectLadcraftChatErrors,
  maybeShowLadcraftErrorDialog,
} from "./ui/agent-errors";
import {
  renderChatView,
  resetChatScroll,
  unmountChatView,
  updateStreamingAssistantText,
  type ChatMessage,
} from "./ui/chat";
import { isAssistantWorkingPlaceholder } from "./ui/assistant-working";
import { stripChoiceArtifacts } from "./ui/widget-choice-list";

type AppScreen = "auth" | "shell" | "chat";

class LadcraftR7App {
  private client = new EaiClient();
  private readonly features = getPluginFeatures();
  private readonly chatTransport = createChatTransport({
    client: this.client,
    features: this.features,
    fallbackToAgentPath: true,
  });
  private readonly streamOrchestrator = new StreamOrchestrator(this.chatTransport, {
    getMessages: () => this.messages,
    setMessageText: (messageId, text, applyText) => {
      const msg = this.messages.find((m) => m.id === messageId);
      if (msg) {
        msg.text = text;
        if (applyText !== undefined) msg.applyText = applyText;
      }
    },
    upsertAssistantBubble: (messageId) => this.upsertStreamingAssistant(messageId),
    patchStreamingDom: (messageId, text, finalize) =>
      updateStreamingAssistantText(this.root, messageId, text, { finalize: Boolean(finalize) }),
    renderChat: () => this.renderChatShell(this.chatStatus),
    isChatScreen: () => this.screen === "chat",
  });
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
  /** Last Ladcraft error dialog shown (avoid re-popup on every poll). */
  private lastShownLadcraftErrorId: string | null = null;
  /** Cell action bar: which of several result .xlsx is selected. */
  private selectedXlsxPath: string | null = null;
  private lastXlsxDeliverableFp = "";
  private isSending = false;
  /** Spreadsheet/document action-bar apply in flight (allow sequential repeats). */
  private actionBusy = false;
  private actionBusySince = 0;
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
  /** Cell-only: debounce re-upload when open workbook is dirty. */
  private workbookBgSyncTimer: ReturnType<typeof setTimeout> | null = null;
  /** Avoid repeating auto Лист/Заменить for the same deliverable + action. */
  private lastAutoSheetKey: string | null = null;
  private lastChatPaintKey = "";
  private sessionAgentId: string | null = null;
  private pendingOutboundUserText: string | null = null;

  constructor(root: HTMLElement) {
    this.root = root;
  }

  /** Initialize plugin after Asc.plugin.init. */
  async start(): Promise<void> {
    applyPanelLayoutClass(this.features);
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

  private currentContextFamily(): ReturnType<typeof resolveContextFamily> {
    const agentId = this.selectedAgentId || getConfig().selectedAgentId;
    return resolveContextFamily(this.editorType, agentId);
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
    const prevState = this.contextState;
    this.contextState = "syncing";
    try {
      const docKey = this.currentDocKey();
      const docSwitched =
        this.boundDocKey != null && this.boundDocKey !== docKey;
      const family = this.currentContextFamily();
      const run = async (forceReupload: boolean) => {
        const ctx =
          family === "spreadsheet"
            ? await ensureWorkbookContext(this.client, this.editorType, {
                sessionId: this.sessionId!,
                forceReupload: forceReupload || docSwitched,
                docKey,
              })
            : await ensureDocumentContext(this.client, this.editorType, {
                sessionId: this.sessionId!,
                forceReupload: forceReupload || docSwitched,
                docKey,
              });
        this.applyContext(ctx, docKey);
      };
      try {
        await run(Boolean(options?.forceReupload));
      } catch (err) {
        // Path occupied / stale binding — one forced re-upload before failing the chat.
        if (!isVfsPathConflictError(err) || options?.forceReupload) throw err;
        clearDocumentContext(getStoredUserId(), docKey);
        await run(true);
      }
    } catch (err) {
      this.contextState = prevState === "syncing" ? "error" : prevState;
      throw err;
    }
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

    // Clear stale VFS binding so renderChatShell → refreshContextState does not
    // race ensureDocumentContext with a second Asc callCommand.
    this.clearContext();
    this.contextState = "syncing";
    this.contextError = null;

    let status = usesDiskRef(this.currentTransferProfile())
      ? "Готовим контекст диска…"
      : usesVfsSnapshot(this.currentTransferProfile())
        ? this.currentContextFamily() === "spreadsheet"
          ? "Готовим книгу в VFS…"
          : "Готовим документ в VFS…"
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
          status =
            this.currentContextFamily() === "spreadsheet"
              ? "Книга в VFS"
              : "Документ в VFS";
        } catch (vfsErr) {
          this.clearContext();
          const vfsMsg = vfsErr instanceof Error ? vfsErr.message : String(vfsErr);
          this.contextState = "error";
          this.contextError = vfsMsg;
          status = `Чат без контекста документа (VFS: ${vfsMsg})`;
          // Do not block the whole chat on VFS: history + messaging still work;
          // user can retry via «Синхр. документ».
          await this.syncChatFromServer(agentId);
          this.chatReady = true;
          void this.refreshContextState();
          this.renderChatShell(status);
          this.startHistorySyncPoll(2500);
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

  /** Abort previous runs (keep history), then create a new Ladcraft session. */
  private async startNewChatSession(agentId: string): Promise<void> {
    const userId = getStoredUserId();
    const known: string[] = [];
    if (this.sessionId) known.push(this.sessionId);
    const bound = getSessionForDoc(userId, this.buildSessionKey(agentId));
    if (bound) known.push(bound);
    // Finish active/queued/waiting_approval runs so the agent queue is free.
    // abort ≠ DELETE — dialogs remain visible on the Ladcraft site.
    await finishPreviousAgentSessions(this.client, agentId, known);
    await this.closeActiveSession(agentId);
    await this.createFreshSession(agentId);
  }

  /** Detach active session locally; does not DELETE on Ladcraft server. */
  private async closeActiveSession(agentId?: string): Promise<void> {
    this.stopHistorySyncPoll();
    this.stopWidgetPoll();
    this.teardownStreamTurn();
    this.isSending = false;

    const agentsToClear = new Set<string>();
    if (this.sessionAgentId) agentsToClear.add(this.sessionAgentId);
    if (agentId) agentsToClear.add(agentId);
    const resolvedAgentId =
      agentId ?? (this.selectedAgentId || getConfig().selectedAgentId);
    if (resolvedAgentId) agentsToClear.add(resolvedAgentId);

    const userId = getStoredUserId();
    const docKey = this.currentDocKey();
    const prevCtx = getDocumentContext(userId, docKey);
    // Best-effort: free session snapshot path so the next chat does not collide.
    if (prevCtx?.vfsFilePath && prevCtx.vfsSessionId) {
      void cleanupSessionDocumentPath(this.client, prevCtx);
    }

    for (const id of agentsToClear) {
      clearSessionForDoc(userId, this.buildSessionKey(id));
    }
    clearDocumentContext(userId, docKey);

    this.sessionId = null;
    this.sessionAgentId = null;
    this.messages = [];
    this.rawHistory = [];
    this.lastShownLadcraftErrorId = null;
    this.selectedXlsxPath = null;
    this.lastXlsxDeliverableFp = "";
    this.chatReady = false;
    this.firstMessageInSession = true;
    this.lastEditorAttachFileId = null;
    this.boundDocKey = null;
    this.needsEditorRemount = true;
    this.chatStatus = "Готово";
    this.clearContext();
    this.contextError = null;
    clearAgentXlsxMatrixCache();
  }

  /** Plugin panel closed — detach local chat state (server session preserved). */
  async shutdown(): Promise<void> {
    this.stopChatPoll();
    this.stopWidgetPoll();
    this.teardownStreamTurn();
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
    this.lastShownLadcraftErrorId = null;
    this.selectedXlsxPath = null;
    this.lastXlsxDeliverableFp = "";
    this.firstMessageInSession = true;
    this.lastEditorAttachFileId = null;
    this.boundDocKey = null;
    this.needsEditorRemount = true;
    clearAgentXlsxMatrixCache();
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

  /**
   * Re-attach applyText from rawHistory so intent-apply sees r7.proposal
   * even if display text was sanitized or stream truncated the fence.
   */
  private enrichAssistantApplyTextFromHistory(): void {
    if (!this.rawHistory.length) return;
    const byId = new Map(this.rawHistory.map((h) => [h.id, h]));
    for (const msg of this.messages) {
      if (msg.role !== "assistant") continue;
      const hist = byId.get(msg.id);
      const fromHist = hist ? extractApplySourceText(hist).trim() : "";
      const current = (msg.applyText || "").trim();
      const pick =
        (parseR7Proposal(fromHist) && fromHist) ||
        (parseR7Proposal(current) && current) ||
        (fromHist.length > current.length ? fromHist : current) ||
        fromHist ||
        current;
      if (pick) msg.applyText = pick;
    }

    // Last-resort: if last draft still has no proposal, scan recent assistants in rawHistory.
    const lastAst = [...this.messages].reverse().find((m) => m.role === "assistant" && !m.widget);
    if (lastAst && !parseR7Proposal(lastAst.applyText || lastAst.text || "")) {
      for (let i = this.rawHistory.length - 1; i >= 0; i--) {
        const h = this.rawHistory[i];
        if (h.role !== "assistant") continue;
        const src = extractApplySourceText(h).trim();
        if (parseR7Proposal(src)) {
          lastAst.applyText = src;
          break;
        }
      }
    }
  }

  /**
   * On approval / «исправь …» apply last r7.proposal (or Черновик fallback) via Asc.
   * "needs-proposal" = no fence in last answer → caller must forward turn to agent (visible on site).
   * Spreadsheet open-sheet replace/format is applied via skill tools (sheet_replace / cell_format),
   * not phrase-intent buttons.
   */
  private async tryIntentApplyFromUserText(
    userText: string,
  ): Promise<"applied" | "blocked" | "noop" | "needs-proposal"> {
    if (this.screen !== "chat" || !this.sessionId) return "noop";
    this.enrichAssistantApplyTextFromHistory();

    // Cell: do not route «замени/оформи/вставь» through Word proposal missing-note.
    if (this.currentContextFamily() === "spreadsheet") {
      return "noop";
    }

    const plan = resolveDocumentApplyPlan(userText, this.messages);
    if (!plan) return "noop";
    if (!plan.tasks.length) {
      if (plan.source === "missing-proposal") {
        this.chatStatus = plan.statusHint || MISSING_PROPOSAL_STATUS;
        this.renderChatShell(this.chatStatus, true);
        return "needs-proposal";
      }
      if (plan.statusHint) {
        this.chatStatus = plan.statusHint;
        this.renderChatShell(this.chatStatus, true);
        return "blocked";
      }
      return "noop";
    }

    return this.executeDocumentApplyPlan(plan);
  }

  /** Action-bar click: same last AI draft as insert; no agent turn. */
  private async handleActionBar(actionId: ActionId): Promise<void> {
    if (this.screen !== "chat" || !this.sessionId) return;
    const spreadsheetActionWhileWaiting =
      this.isSending &&
      this.currentContextFamily() === "spreadsheet" &&
      (actionId === "download_vfs_xlsx" ||
        actionId === "sheet_from_xlsx" ||
        actionId === "paste_xlsx_matrix" ||
        actionId === "replace_active_sheet" ||
        actionId === "download_csv") &&
      Boolean(this.resolveActiveXlsxDeliverable());
    if (this.isSending && !spreadsheetActionWhileWaiting) {
      this.chatStatus = "Дождитесь ответа агента";
      this.renderChatShell(this.chatStatus, true);
      return;
    }
    this.enrichAssistantApplyTextFromHistory();

    if (actionId === "download_vfs_xlsx") {
      this.enrichAssistantApplyTextFromHistory();
      const item = this.resolveActiveXlsxDeliverable();
      if (!item || !this.sessionId) {
        this.chatStatus = "Нет файла агента для скачивания";
        this.renderChatShell(this.chatStatus, true);
        return;
      }
      await this.downloadAgentVfsFile(item.vfsPath, item.fileName);
      return;
    }

    if (
      actionId === "sheet_from_xlsx" ||
      actionId === "paste_xlsx_matrix" ||
      actionId === "replace_active_sheet" ||
      (actionId === "download_csv" && this.currentContextFamily() === "spreadsheet")
    ) {
      await this.handleSpreadsheetXlsxAction(actionId);
      return;
    }

    const target = resolveActionTarget(this.messages);
    if (!target) {
      this.chatStatus = "Нет черновика для действия";
      this.renderChatShell(this.chatStatus, true);
      return;
    }

    if (actionId === "download_md" || actionId === "download_word_html" || actionId === "download_csv") {
      const text = resolveInsertableText(target.raw);
      if (!text.trim() && actionId !== "download_csv") {
        this.chatStatus = "Нет текста для скачивания";
        this.renderChatShell(this.chatStatus, true);
        return;
      }
      try {
        if (actionId === "download_md") {
          downloadTextAsMarkdown(text, "черновик");
          this.chatStatus = "Скачан .md";
        } else if (actionId === "download_csv") {
          const body = text.trim() || resolveInsertableText(target.raw);
          if (!body.trim()) {
            this.chatStatus = "Нет таблицы для CSV";
            this.renderChatShell(this.chatStatus, true);
            return;
          }
          downloadTextAsCsv(body, "таблица");
          this.chatStatus = "Скачан .csv";
        } else {
          downloadTextAsWordHtml(text, "черновик");
          this.chatStatus = "Скачан файл для Word (.html)";
        }
        this.renderChatShell(this.chatStatus, true);
      } catch (err) {
        console.warn("[ladcraft-r7_new] download failed", err);
        this.chatStatus = "Не удалось скачать файл";
        this.renderChatShell(this.chatStatus, true);
      }
      return;
    }

    const plan = planFromActionId(actionId, target);
    if (!plan || !plan.tasks.length) {
      this.chatStatus = "Действие недоступно для этого ответа";
      this.renderChatShell(this.chatStatus, true);
      return;
    }

    await this.executeDocumentApplyPlan(plan, { allowRepeat: true });
  }

  /** Cell: insert/download/replace matrix from latest agent .xlsx (repeatable). */
  private async handleSpreadsheetXlsxAction(
    actionId:
      | "sheet_from_xlsx"
      | "paste_xlsx_matrix"
      | "replace_active_sheet"
      | "download_csv",
  ): Promise<void> {
    if (!this.sessionId) return;
    // Stuck Asc/VFS call can leave actionBusy=true forever — auto-unlock after 90s (safety net).
    if (this.actionBusy && this.actionBusySince && Date.now() - this.actionBusySince > 90_000) {
      this.actionBusy = false;
      this.actionBusySince = 0;
    }
    if (this.actionBusy) {
      this.chatStatus = "Дождитесь завершения предыдущего действия";
      this.renderChatShell(this.chatStatus, true);
      return;
    }
    this.enrichAssistantApplyTextFromHistory();
    const item = this.resolveActiveXlsxDeliverable();
    if (!item) {
      this.chatStatus = "Нет .xlsx результата в последнем ответе агента";
      this.renderChatShell(this.chatStatus, true);
      return;
    }
    this.actionBusy = true;
    this.actionBusySince = Date.now();
    try {
      this.chatStatus = "Читаю итог…";
      this.renderChatShell(this.chatStatus, true);
      const matrix = await this.withSendTimeout(
        loadAgentXlsxMatrix(this.client, this.sessionId, item.vfsPath, {
          excludePath: this.contextFilePath,
        }),
        60_000,
        "Чтение .xlsx",
      );

      if (actionId === "download_csv") {
        const base = item.fileName.replace(/\.xlsx$/i, "") || "таблица";
        triggerBrowserDownload(
          new Blob([matrixToCsv(matrix.aoa)], { type: "text/csv;charset=utf-8" }),
          `${base}.csv`,
        );
        this.chatStatus = `Скачан ${base}.csv`;
        this.renderChatShell(this.chatStatus, true);
        return;
      }

      this.chatStatus =
        actionId === "sheet_from_xlsx"
          ? "Пишу на новый лист…"
          : actionId === "replace_active_sheet"
            ? "Заменяю текущий лист…"
            : "Вставляю…";
      this.renderChatShell(this.chatStatus, true);

      // Completion = Asc callCommand success callback (not “wait N seconds”).
      // 12s is only a watchdog if Asc writes cells but never fires the callback.
      try {
        await this.withSendTimeout(
          withAction(async () => {
            if (actionId === "sheet_from_xlsx") {
              const preferred = preferredSheetNameFromFile(
                matrix.sheetName || item.fileName,
              );
              const { sheetName, written } = await applyMatrixOnNewSheet(matrix.aoa, preferred);
              if (!written) {
                throw new Error("Не удалось записать данные на новый лист");
              }
              this.chatStatus = `Лист «${sheetName}»: ${written} яч.`;
            } else if (actionId === "replace_active_sheet") {
              const written = await applyMatrixReplaceActiveSheet(matrix.aoa);
              if (!written) {
                throw new Error("Не удалось заменить данные на текущем листе");
              }
              this.chatStatus = `Заменено на текущем листе: ${written} яч.`;
            } else {
              const written = await applyMatrixAtActiveCell(matrix.aoa);
              this.chatStatus = `Вставлено ${written} яч.`;
            }
          }),
          12_000,
          "Запись в лист",
        );
      } catch (writeErr) {
        const msg = writeErr instanceof Error ? writeErr.message : String(writeErr);
        if (/таймаут/i.test(msg)) {
          throw new Error(
            "Запись зависла в редакторе — проверьте лист; можно повторить",
          );
        }
        throw writeErr;
      }
      // After Лист/Вставить/Заменить the open workbook changed — mark dirty for background sync.
      this.contextState = "dirty";
      this.scheduleWorkbookBackgroundSync();
      this.renderChatShell(this.chatStatus, true);
    } catch (err) {
      console.warn("[ladcraft-r7_new] spreadsheet xlsx action failed", err);
      this.chatStatus =
        err instanceof Error ? err.message : "Не удалось вставить итог из .xlsx";
      this.renderChatShell(this.chatStatus, true);
    } finally {
      this.actionBusy = false;
      this.actionBusySince = 0;
      this.renderChatShell(this.chatStatus, true);
    }
  }

  /**
   * If the user explicitly asked for a new sheet or to replace the open sheet,
   * apply the latest agent .xlsx via the same path as «Лист» / «Заменить».
   */
  private async tryAutoSheetFromUserIntent(userText: string): Promise<void> {
    if (this.screen !== "chat" || !this.sessionId) return;
    if (this.currentContextFamily() !== "spreadsheet") return;
    if (this.actionBusy || this.isSending) return;

    const wantNew = wantsNewSheetInOpenWorkbook(userText);
    const wantReplace = wantsReplaceOpenSheet(userText);
    if (!wantNew && !wantReplace) return;

    this.enrichAssistantApplyTextFromHistory();
    const item = this.resolveActiveXlsxDeliverable();
    if (!item) return;

    const actionId = wantReplace ? "replace_active_sheet" : "sheet_from_xlsx";
    const key = `${actionId}:${item.vfsPath}`;
    if (this.lastAutoSheetKey === key) return;

    this.lastAutoSheetKey = key;
    await this.handleSpreadsheetXlsxAction(actionId);
  }

  private async executeDocumentApplyPlan(
    plan: import("./apply/intent-apply").DocumentApplyPlan,
    options?: { allowRepeat?: boolean },
  ): Promise<"applied" | "blocked" | "noop"> {
    const allowRepeat = options?.allowRepeat === true;
    const appliedKeys = allowRepeat ? new Set<string>() : this.loadAppliedEditorTaskKeys();
    if (!allowRepeat && planDedupeHit(plan, appliedKeys)) {
      this.chatStatus = "Уже применено";
      this.renderChatShell(this.chatStatus, true);
      return "applied";
    }

    const pendingTasks = allowRepeat
      ? plan.tasks
      : plan.tasks.filter((task) => !appliedKeys.has(taskContentKey(task)));
    if (!pendingTasks.length) {
      if (!allowRepeat) {
        for (const k of plan.dedupeKeys) appliedKeys.add(k);
        this.persistAppliedEditorTaskKeys(appliedKeys);
      }
      this.chatStatus = "Уже применено";
      this.renderChatShell(this.chatStatus, true);
      return "applied";
    }

    if (plan.requireSelection) {
      const sel = (await getSelectedText()).trim();
      if (!sel) {
        this.chatStatus =
          "Выделите фрагмент в документе и повторите «да» / «вставь»";
        this.renderChatShell(this.chatStatus, true);
        return "blocked";
      }
    }

    this.chatStatus = plan.statusHint || "Вставляю в документ…";
    this.renderChatShell(this.chatStatus, true);

    try {
      const result = await applyEditorTasks(this.editorType, pendingTasks);
      if (!result.successfulTasks.length && !result.failed) return "noop";

      if (result.successfulTasks.length) {
        if (!allowRepeat) {
          for (const task of result.successfulTasks) {
            appliedKeys.add(taskContentKey(task));
          }
          for (const k of plan.dedupeKeys) appliedKeys.add(k);
          this.persistAppliedEditorTaskKeys(appliedKeys);
        }
        this.needsEditorRemount = true;
      }

      if (result.summary) {
        this.chatStatus = result.summary;
      } else if (result.successfulTasks.length) {
        this.chatStatus =
          result.successfulTasks[0]?.type === "replace_selection"
            ? "Заменено в документе"
            : "Вставлено в документ";
      } else if (result.failed) {
        this.chatStatus = "Не удалось применить изменение в документе";
      }
      this.renderChatShell(this.chatStatus, true);

      if (result.successfulTasks.length) return "applied";
      if (result.failed) return "blocked";
      return "noop";
    } catch (err) {
      console.warn("[ladcraft-r7_new] intent apply failed", err);
      this.chatStatus = "Не удалось применить изменение в документе";
      this.renderChatShell(this.chatStatus, true);
      return "blocked";
    }
  }

  private async tryApplyEditorTasksFromHistory(): Promise<void> {
    if (this.screen !== "chat" || !this.sessionId || this.isSending) return;
    if (this.isServiceFeedbackInFlight) return;

    const appliedKeys = this.loadAppliedEditorTaskKeys();
    const pending = collectPendingEditorTasks(this.rawHistory, appliedKeys);
    if (!pending.length) return;

    const result = await applyEditorTasks(
      this.editorType,
      pending.map((item) => item.task),
      {
        loadXlsxMatrix: async (path, sheet) => {
          if (!this.sessionId) throw new Error("Нет sessionId");
          const matrix = await loadAgentXlsxMatrix(this.client, this.sessionId, path, {
            excludePath: this.contextFilePath,
            sheet,
          });
          return { aoa: matrix.aoa, sheetName: matrix.sheetName };
        },
      },
    );
    if (!result.successfulTasks.length && !result.failed) return;

    const hadSheetMutation = result.successfulTasks.some(
      (t) => t.type === "sheet_replace_from_xlsx" || t.type === "cell_format",
    );
    if (hadSheetMutation) {
      this.contextState = "dirty";
      this.scheduleWorkbookBackgroundSync();
    }

    const successFingerprints = new Set(
      result.successfulTasks.map((task) => `${task.type}:${JSON.stringify(task.data)}`),
    );
    for (const item of pending) {
      const fingerprint = `${item.task.type}:${JSON.stringify(item.task.data)}`;
      if (!successFingerprints.has(fingerprint)) continue;
      appliedKeys.add(taskApplyKey(item.messageId, item.task));
      appliedKeys.add(taskContentKey(item.task));
    }
    this.persistAppliedEditorTaskKeys(appliedKeys);
    this.needsEditorRemount = true;

    if (result.summary) {
      this.chatStatus = result.summary;
      this.renderChatShell(this.chatStatus, true);
    }

    if (result.applied + result.failed > 0) {
      const notifyTasks =
        result.successfulTasks.length > 0
          ? result.successfulTasks
          : pending.map((p) => p.task);
      await this.sendApplyFeedbackQuiet(
        result,
        pending.map((p) => p.messageId),
        notifyTasks,
      );
    }
  }

  private isServiceFeedbackInFlight = false;

  /** POST r7.event without optimistic UI bubble or prepareOutbound snapshot. */
  private async sendApplyFeedbackQuiet(
    result: Awaited<ReturnType<typeof applyEditorTasks>>,
    messageIds: string[],
    notifyTasks: R7Task[],
  ): Promise<void> {
    if (!this.sessionId || !this.client.isAuthenticated()) return;
    const notifyKey = feedbackNotifyKey(this.sessionId, notifyTasks);
    try {
      const raw = sessionStorage.getItem(`ladcraft_r7_event_notified:${this.sessionId}`);
      const notified = raw ? (JSON.parse(raw) as string[]) : [];
      if (Array.isArray(notified) && notified.includes(notifyKey)) return;
      const next = Array.isArray(notified) ? notified.concat(notifyKey) : [notifyKey];
      sessionStorage.setItem(
        `ladcraft_r7_event_notified:${this.sessionId}`,
        JSON.stringify(next.slice(-80)),
      );
    } catch {
      /* continue send */
    }

    const payload = buildApplyEventPayload(result, [...new Set(messageIds)]);
    const content = formatR7EventBlock(payload);
    this.isServiceFeedbackInFlight = true;
    try {
      await sendMessage(this.client, this.sessionId, { content });
    } catch (err) {
      console.warn("[ladcraft-r7_new] r7.event feedback failed", err);
    } finally {
      this.isServiceFeedbackInFlight = false;
    }
  }

  private loadAppliedEditorTaskKeys(): Set<string> {
    if (!this.sessionId) return new Set();
    try {
      const raw = sessionStorage.getItem(`ladcraft_r7_applied_tasks:${this.sessionId}`);
      if (!raw) return new Set();
      const parsed = JSON.parse(raw) as unknown;
      if (!Array.isArray(parsed)) return new Set();
      return new Set(parsed.filter((item) => typeof item === "string"));
    } catch {
      return new Set();
    }
  }

  private persistAppliedEditorTaskKeys(keys: Set<string>): void {
    if (!this.sessionId) return;
    sessionStorage.setItem(
      `ladcraft_r7_applied_tasks:${this.sessionId}`,
      JSON.stringify([...keys]),
    );
  }

  private mergePendingOutboundUserMessage(serverMessages: ChatMessage[]): ChatMessage[] {
    const pending = this.pendingOutboundUserText?.trim();
    if (!pending) return serverMessages;
    const alreadyOnServer = serverMessages.some(
      (m) => m.role === "user" && m.text.trim() === pending,
    );
    if (alreadyOnServer) return serverMessages;
    return [
      ...serverMessages,
      {
        id: `local-pending-${pending.length}`,
        role: "user",
        text: this.pendingOutboundUserText!,
      },
    ];
  }

  /**
   * Keep SSE-painted assistant body when history sync would rewrite the same bubble.
   * Widgets / waiting flags still come from the server.
   */
  private mergePreservingStreamedAssistant(serverMessages: ChatMessage[]): ChatMessage[] {
    if (!this.messages.length) return serverMessages;
    const localById = new Map(this.messages.map((m) => [m.id, m]));
    return serverMessages.map((server) => {
      if (server.role !== "assistant") return server;
      const local = localById.get(server.id);
      if (!local || local.role !== "assistant") return server;
      const localText = (local.text || "").trim();
      if (!localText || localText === "Агент выполняет запрос…") return server;
      if (isAssistantWorkingPlaceholder(localText)) return server;
      // Server gained interactive UI — take server body for that path.
      if (server.widget || server.widgetChoices?.length || server.waitingForInput) {
        return server;
      }
      const serverText = (server.text || "").trim();
      const localNorm = localText.replace(/\s+/g, " ");
      const serverNorm = serverText.replace(/\s+/g, " ");
      // Prefer streamed paint when equal / local is a prefix of server (late history bits).
      // Also keep stream when history inflated a duplicated body (timeline join bug).
      const serverLooksDup =
        serverNorm.length > localNorm.length * 1.35 &&
        serverNorm.includes(localNorm.slice(0, Math.min(100, localNorm.length)));
      if (
        localNorm === serverNorm ||
        serverNorm.startsWith(localNorm) ||
        localNorm.startsWith(serverNorm) ||
        serverLooksDup ||
        localText.length >= Math.max(40, serverText.length * 0.85)
      ) {
        return {
          ...server,
          text: local.text,
          applyText: local.applyText || server.applyText,
        };
      }
      return server;
    });
  }

  private async loadHistoryFromServer(): Promise<void> {
    if (!this.sessionId) return;
    const history = await getHistoryMessages(this.client, this.sessionId);
    this.rawHistory = history;
    const serverMessages = historyToChatMessages(history, {
      editorType: this.editorType,
    });
    this.messages = this.mergePreservingStreamedAssistant(
      this.mergePendingOutboundUserMessage(serverMessages),
    );
    // History sync wipes local-working; keep a spinner while the turn is in flight
    // (VFS sync + thinking before SSE creates a real assistant id).
    this.reassertWorkingBubbleIfSending();
    this.firstMessageInSession = !this.messages.some((m) => m.role === "user");
    this.maybeNotifyLadcraftErrors();
  }

  /** After server history replace: restore spinner if the turn is still open. */
  private reassertWorkingBubbleIfSending(): void {
    if (!this.isSending) return;
    const lastAst = [...this.messages].reverse().find((m) => m.role === "assistant");
    if (lastAst) {
      const text = (lastAst.text || "").trim();
      if (
        lastAst.id !== "local-working" &&
        text &&
        text !== STREAMING_WORKING_PLACEHOLDER &&
        !isAssistantWorkingPlaceholder(text)
      ) {
        // Real answer already on screen — drop stale local spinner.
        this.messages = this.messages.filter((m) => m.id !== "local-working");
        return;
      }
      if (isAssistantWorkingPlaceholder(text) || lastAst.widget || lastAst.waitingForInput) {
        return;
      }
    }
    this.ensureLocalWorkingBubble();
  }

  private maybeNotifyLadcraftErrors(): void {
    const errors = collectLadcraftChatErrors(this.rawHistory);
    this.lastShownLadcraftErrorId = maybeShowLadcraftErrorDialog(
      errors,
      this.lastShownLadcraftErrorId,
    );
  }

  private resolveActiveXlsxDeliverable() {
    this.syncXlsxDeliverableSelection();
    return resolveSelectedAgentDeliverable(
      this.messages,
      this.rawHistory,
      this.selectedXlsxPath,
      { excludePath: this.contextFilePath },
    );
  }

  /** Keep picker selection in sync with the latest assistant turn's files. */
  private syncXlsxDeliverableSelection(): {
    vfsPath: string;
    fileName: string;
    label: string;
  }[] {
    const listed = listLatestAssistantDeliverables(this.messages, this.rawHistory, {
      excludePath: this.contextFilePath,
    });
    const fp = listed.map((d) => d.vfsPath).join("|");
    if (fp !== this.lastXlsxDeliverableFp) {
      this.lastXlsxDeliverableFp = fp;
      this.selectedXlsxPath = listed[0]?.vfsPath || null;
    } else if (
      this.selectedXlsxPath &&
      !listed.some((d) => d.vfsPath === this.selectedXlsxPath)
    ) {
      this.selectedXlsxPath = listed[0]?.vfsPath || null;
    } else if (!this.selectedXlsxPath && listed.length) {
      this.selectedXlsxPath = listed[0].vfsPath;
    }
    return listed.map((d) => ({
      vfsPath: d.vfsPath,
      fileName: d.fileName,
      label: deliverableChipLabel(d),
    }));
  }

  private awaitingCompareReport(): boolean {
    return isAwaitingCompareReport(this.rawHistory);
  }

  private renderChatShell(status: string, force = false): void {
    if (this.screen !== "chat") return;
    this.chatStatus = status;
    const contextStateBefore = this.contextState;
    const contextErrorBefore = this.contextError;

    const paint = (forcePaint = false): void => {
      const diskRef = usesDiskRef(this.currentTransferProfile());
      const xlsxDeliverables = this.syncXlsxDeliverableSelection();
      const paintKey = [
        status,
        this.historyFingerprint(),
        this.isSending,
        this.chatReady,
        this.contextState,
        this.contextError ?? "",
        this.agentLabel,
        this.editorType,
        resolveActionTarget(this.messages)?.fingerprint ?? "",
        this.currentContextFamily(),
        this.selectedXlsxPath ?? "",
        this.lastXlsxDeliverableFp,
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
          editorType: this.editorType,
          contextFamily: this.currentContextFamily(),
          xlsxDeliverables,
          selectedXlsxPath: this.selectedXlsxPath,
          history: this.rawHistory,
          excludeXlsxPath: this.contextFilePath,
        },
        {
          onBack: () => {
            void this.exitChatToShell(true);
          },
          onLogout: () => this.logout(),
          onRefreshContext: () => this.handleRefreshContext(),
          onSend: (text) => this.handleSend(text),
          onWidgetSubmit: (text) => this.handleSend(text),
          onAction: (actionId) => this.handleActionBar(actionId),
          onSelectXlsx: (vfsPath) => {
            this.selectedXlsxPath = vfsPath;
            this.lastChatPaintKey = "";
            this.chatStatus = `Выбрано: ${vfsPath.split("/").pop() || vfsPath}`;
            this.renderChatShell(this.chatStatus, true);
          },
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
    this.screen = "shell";
    this.stopHistorySyncPoll();
    this.stopWidgetPoll();
    this.clearWorkbookBackgroundSync();
    this.teardownStreamTurn();
    this.isSending = false;
    this.pendingOutboundUserText = null;
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
      .map(
        (m) =>
          `${m.id}:${m.text.length}:${m.widget ? 1 : 0}:${m.widgetChoices?.length ?? 0}`,
      )
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
      if (this.streamOrchestrator.shouldDeferHistorySync()) {
        return;
      }
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

    void this.tryApplyEditorTasksFromHistory();

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

  private teardownStreamTurn(): void {
    this.streamOrchestrator.teardown();
  }

  private upsertStreamingAssistant(messageId: string): void {
    this.clearLocalWorkingBubble();
    const existing = this.messages.find((m) => m.id === messageId);
    if (existing) return;
    this.messages.push({
      id: messageId,
      role: "assistant",
      text: STREAMING_WORKING_PLACEHOLDER,
    });
    this.renderChatShell(this.chatStatus);
  }

  private ensureLocalWorkingBubble(): void {
    const id = "local-working";
    if (this.messages.some((m) => m.id === id)) return;
    this.messages.push({
      id,
      role: "assistant",
      text: STREAMING_WORKING_PLACEHOLDER,
    });
  }

  private clearLocalWorkingBubble(): void {
    const before = this.messages.length;
    this.messages = this.messages.filter((m) => m.id !== "local-working");
    if (this.messages.length !== before && this.screen === "chat") {
      this.renderChatShell(this.chatStatus);
    }
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

  private async downloadAgentVfsFile(vfsPath: string, fileName: string): Promise<void> {
    if (!this.sessionId) return;
    try {
      const resolved = await resolveSessionXlsxFile(
        this.client,
        this.sessionId,
        vfsPath,
        { excludePath: this.contextFilePath },
      );
      let fileId = resolved?.fileId ?? null;
      let outName = resolved?.fileName || fileName;
      if (!fileId && this.contextFilePath && vfsPath.includes(this.contextFileName || "")) {
        fileId = this.contextFileId ?? null;
      }
      if (!fileId) {
        this.chatStatus = "Файл не найден в session VFS";
        this.renderChatShell(this.chatStatus, true);
        return;
      }
      const blob = await downloadVfsFile(this.client, fileId, "original");
      downloadBlob(blob, outName.endsWith(".xlsx") ? outName : `${outName}.xlsx`);
      this.chatStatus =
        resolved && normalizeSessionVfsPath(resolved.vfsPath) !== normalizeSessionVfsPath(vfsPath)
          ? `Скачан ${outName} (последний .xlsx в VFS)`
          : `Скачан ${outName}`;
      this.renderChatShell(this.chatStatus, true);
    } catch (err) {
      console.warn("[ladcraft-r7_new] vfs download failed", err);
      this.chatStatus = "Не удалось скачать файл из VFS";
      this.renderChatShell(this.chatStatus, true);
    }
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

    // Avoid Asc callCommand while VFS sync is in progress (parallel → undefined).
    if (this.contextState === "syncing") return;
    // Also skip dirty-check during send/wait — renderChatShell paints often and
    // parallel callCommand races with document reads used by the send path.
    if (this.isSending) return;

    const docKey = this.currentDocKey();
    if (this.boundDocKey && this.boundDocKey !== docKey) {
      this.contextState = "dirty";
      this.contextError = null;
      this.scheduleWorkbookBackgroundSync();
      return;
    }
    if (!this.contextFileId) {
      if (this.contextState !== "error") {
        this.contextState = "no_vfs";
      }
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
        this.scheduleWorkbookBackgroundSync();
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
      if (dirty) this.scheduleWorkbookBackgroundSync();
      else this.clearWorkbookBackgroundSync();
    } catch (err) {
      this.contextState = "error";
      this.contextError = err instanceof Error ? err.message : String(err);
    }
  }

  private clearWorkbookBackgroundSync(): void {
    if (this.workbookBgSyncTimer != null) {
      clearTimeout(this.workbookBgSyncTimer);
      this.workbookBgSyncTimer = null;
    }
  }

  /**
   * Cell + vfs only: after dirty, quietly re-upload workbook before the next user send.
   * Word/document keeps send-time sync only.
   */
  private scheduleWorkbookBackgroundSync(): void {
    if (this.editorType !== "cell") return;
    if (!usesVfsSnapshot(this.currentTransferProfile())) return;
    if (this.screen !== "chat" || !this.sessionId || this.isSending) return;
    if (this.contextState === "syncing") return;
    this.clearWorkbookBackgroundSync();
    this.workbookBgSyncTimer = setTimeout(() => {
      this.workbookBgSyncTimer = null;
      void this.runWorkbookBackgroundSync();
    }, 2500);
  }

  private async runWorkbookBackgroundSync(): Promise<void> {
    if (this.editorType !== "cell") return;
    if (!usesVfsSnapshot(this.currentTransferProfile())) return;
    if (this.screen !== "chat" || !this.sessionId || this.isSending) return;
    if (this.contextState !== "dirty") return;
    try {
      await this.syncDocumentContextForChat();
      this.contextState = "synced";
      this.contextError = null;
      if (this.screen === "chat" && !this.isSending) {
        this.renderChatShell(this.chatStatus);
      }
    } catch (err) {
      console.warn("[ladcraft-r7_new] workbook background sync failed", err);
      this.contextState = "dirty";
      this.contextError = err instanceof Error ? err.message : String(err);
    }
  }

  private async handleSend(text: string): Promise<void> {
    if (!this.sessionId || this.isSending || !this.chatReady) return;

    const agentId = this.selectedAgentId || getConfig().selectedAgentId;
    if (!agentId) return;

    // Strip false `*.md` suffix from analytics option clicks before local UI + API.
    const cleaned = stripChoiceArtifacts(text);
    if (!cleaned.trim()) return;

    this.isSending = true;
    this.pendingOutboundUserText = cleaned;
    this.chatStatus = "Агент думает…";
    const userMsg: ChatMessage = {
      id: `local-${Date.now()}`,
      role: "user",
      text: cleaned,
    };
    this.messages.push(userMsg);
    // Optimistic spinner bubble for the whole turn (VFS sync + wait before SSE).
    this.ensureLocalWorkingBubble();
    this.renderChatShell(this.chatStatus, true);
    this.startChatPoll();

    try {
      // Local Asc apply from proposal — do not open an agent turn on success / hard block.
      const intentResult = await this.tryIntentApplyFromUserText(cleaned);
      if (intentResult === "applied" || intentResult === "blocked") {
        // Keep local user bubble for context; agent never sees this approval.
        this.pendingOutboundUserText = null;
        return;
      }

      // No proposal in last answer: forward to Ladcraft so the phrase appears on the site
      // and the agent can regenerate with r7.proposal.
      let outboundText = cleaned;
      if (intentResult === "needs-proposal") {
        outboundText = `${cleaned.trim()}\n\n${MISSING_PROPOSAL_AGENT_NOTE}`;
        this.pendingOutboundUserText = outboundText;
        this.chatStatus = "Ожидание ответа (нужен r7.proposal)…";
        this.reassertWorkingBubbleIfSending();
        this.renderChatShell(this.chatStatus, true);
      }

      this.teardownStreamTurn();
      this.streamOrchestrator.beginTurn();

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
          this.chatStatus = "Синхронизация книги…";
          this.reassertWorkingBubbleIfSending();
          this.renderChatShell(this.chatStatus, true);
          await this.withSendTimeout(
            this.syncDocumentContextForChat(),
            90_000,
            "Синхронизация документа",
          );
        } else if (usesDiskRef(this.currentTransferProfile())) {
          this.applyDiskRefContext();
        }
      } catch (ctxErr) {
        const msg = ctxErr instanceof Error ? ctxErr.message : String(ctxErr);
        // One more forced sync before failing the user turn.
        if (usesVfsSnapshot(this.currentTransferProfile())) {
          try {
            await this.withSendTimeout(
              this.syncDocumentContextForChat({ forceReupload: true }),
              90_000,
              "Повторная синхронизация документа",
            );
          } catch (retryErr) {
            const retryMsg =
              retryErr instanceof Error ? retryErr.message : String(retryErr);
            console.error("Context sync before send failed:", retryErr);
            this.clearContext();
            this.contextState = "error";
            this.contextError = retryMsg;
            throw new Error(
              `Документ не в VFS: ${this.contextError}. Нажмите «Синхр. документ».`,
            );
          }
        } else {
          console.error("Context sync before send failed:", ctxErr);
          this.clearContext();
          this.contextState = "error";
          this.contextError = msg;
          if (usesDiskRef(this.currentTransferProfile())) {
            throw new Error(
              `Контекст диска: ${this.contextError}. Нажмите «Обновить контекст».`,
            );
          }
          throw new Error(msg);
        }
      }

      const activeSessionId = this.sessionId;
      if (activeSessionId && this.features.sseStreaming) {
        this.streamOrchestrator.subscribe(activeSessionId);
      }

      // Free waiting_approval/queued (and leftover analytics run) so follow-up starts.
      this.chatStatus = "Подготовка хода…";
      this.reassertWorkingBubbleIfSending();
      this.renderChatShell(this.chatStatus, true);
      await ensureAgentQueueIdleBeforeSend(this.client, agentId, activeSessionId || "");

      await this.sendUserMessage(outboundText, agentId);
      this.chatStatus = this.awaitingCompareReport()
        ? "Агент выполняет сравнение…"
        : "Агент выполняет запрос…";
      this.reassertWorkingBubbleIfSending();
      await this.syncChatFromServer(agentId);
      this.reassertWorkingBubbleIfSending();
      this.renderChatShell(this.chatStatus, true);

      if (this.firstMessageInSession) {
        this.firstMessageInSession = false;
      }

      if (isCompareTurnRequest(outboundText, this.rawHistory)) {
        this.chatStatus = "Агент выполняет сравнение…";
        this.reassertWorkingBubbleIfSending();
        this.renderChatShell(this.chatStatus, true);
      }

      const waitTimeoutMs = resolveAssistantWaitTimeoutMs(outboundText, this.rawHistory);

      const turn = await waitForAssistantTurn(
        this.client,
        this.sessionId,
        beforeCount,
        waitTimeoutMs,
        (progress) => {
          if (this.screen !== "chat") return;
          if (this.chatStatus === progress) return;
          this.chatStatus = progress;
          this.renderChatShell(this.chatStatus);
        },
        async () => {
          await this.streamOrchestrator.runOnPollSync(async () => {
            const before = this.historyFingerprint();
            await this.syncChatFromServer(agentId);
            if (this.historyFingerprint() !== before) {
              this.renderChatShell(this.chatStatus);
            }
          });
        },
        {
          pollMs: this.streamOrchestrator.getWaitPollMs(),
          agentId,
          orphanDetectMs: 16_000,
          onOrphanRetry: async () => {
            // History already has the orphaned user row; re-POST so Ladcraft starts a run.
            const hist = await getHistoryMessages(this.client, this.sessionId!);
            const after = hist.length;
            await this.sendUserMessage(outboundText, agentId);
            return after;
          },
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
        // Ensure local spinner does not hide a clarification form from history.
        this.clearLocalWorkingBubble();
        const last = [...this.messages].reverse().find((m) => m.role === "assistant");
        const hasForm = Boolean(last?.widget || last?.widgetChoices?.length);
        this.chatStatus = hasForm
          ? "Выберите вариант в форме"
          : "Ожидание формы или ответьте текстом";
        this.renderChatShell(this.chatStatus, true);
        return;
      }

      await this.syncChatFromServer(agentId);
      // Editor apply runs in `finally` after isSending=false — calling it here is a no-op
      // (tryApplyEditorTasksFromHistory guards on isSending).
      this.chatStatus = this.awaitingCompareReport()
        ? "Агент выполняет сравнение..."
        : this.chatStatus.startsWith("Изменение") ||
            this.chatStatus.startsWith("Применено") ||
            this.chatStatus.startsWith("Не удалось")
          ? this.chatStatus
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
      this.teardownStreamTurn();
      this.clearLocalWorkingBubble();
      this.isSending = false;
      this.pendingOutboundUserText = null;
      this.stopHistorySyncPoll();
      if (this.screen !== "chat") return;

      // Apply r7_* tool results to the open document immediately (not only on the 2.5s poll).
      // Skill `ok: true` only means the task was emitted — Word changes happen here.
      try {
        await this.tryApplyEditorTasksFromHistory();
      } catch (err) {
        console.warn("[ladcraft-r7_new] apply after send failed", err);
      }

      try {
        await this.tryAutoSheetFromUserIntent(cleaned);
      } catch (err) {
        console.warn("[ladcraft-r7_new] auto sheet after send failed", err);
      }

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

  private async withSendTimeout<T>(
    promise: Promise<T>,
    timeoutMs: number,
    label: string,
  ): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        promise,
        new Promise<T>((_, reject) => {
          timer = setTimeout(
            () => reject(new Error(`${label}: таймаут ${Math.round(timeoutMs / 1000)} с`)),
            timeoutMs,
          );
        }),
      ]);
    } finally {
      if (timer != null) clearTimeout(timer);
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
          agentId,
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
  // Bust CSS cache when plugin JS version changes (R7 often caches styles/main.css).
  try {
    const href = `styles/main.css?v=${PLUGIN_VERSION}`;
    let link = document.querySelector("link[data-lc-css]") as HTMLLinkElement | null;
    if (!link) {
      link = document.createElement("link");
      link.rel = "stylesheet";
      link.setAttribute("data-lc-css", "1");
      document.head.appendChild(link);
    }
    if (!String(link.getAttribute("href") || "").includes(PLUGIN_VERSION)) {
      link.setAttribute("href", href);
    }
  } catch (_) {}
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
