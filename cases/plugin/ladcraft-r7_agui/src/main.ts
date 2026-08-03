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
  collectPendingSearchReplaceFromChat,
  taskApplyKey,
  taskContentKey,
} from "./apply/task-runner";
import {
  detectWordFormatIntent,
  planWordFormatTransform,
  resolveWordFormatSourceMarkdown,
} from "./apply/word-format-intent";
import {
  planDedupeHit,
  resolveDocumentApplyPlan,
  planLexicalSearchReplace,
  planFindingsBySearchHint,
  planFindingsPronounReplace,
  planLocalComment,
  parseFixIntent,
  planFromFindingsItems,
  resolveFindingsAutoApplyPlan,
  isLexicalSearchReplaceIntent,
  isRemoveCommentsIntent,
  isDocumentApplyApproval,
  findingsHaveCategoryTags,
  isMechanicalFindingCategory,
  MISSING_PROPOSAL_AGENT_NOTE,
  MISSING_PROPOSAL_STATUS,
  type FixIntent,
} from "./apply/intent-apply";
import {
  actionTargetKey,
  fixIntentFromActionId,
  hashText,
  isFindingsFixActionId,
  planFromActionId,
  resolveDocumentActionTarget,
  resolveActionTarget,
  resolveInsertableText,
  type ActionId,
  type ActionTarget,
} from "./apply/action-buttons";
import { parseR7Proposal } from "./apply/proposal-parse";
import { absorbFontHintsFromUserText } from "./ui/word-font-prefs";
import {
  downloadTextAsMarkdown,
  downloadTextAsWordHtml,
  downloadTextAsCsv,
  downloadBlob,
  triggerBrowserDownload,
} from "./apply/local-download";
import {
  deliverableChipLabel,
  hasReadyAnalyticsFromChat,
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
  applyCellFormatSpec,
  withAction,
} from "./apply/editor-methods";
import {
  wantsNewSheetInOpenWorkbook,
  wantsReplaceOpenSheet,
} from "./apply/spreadsheet-intent";
import {
  appendLastLocalFormatSupplement,
  inferCellFormatIntentFromUserText,
  rebuildSpecAsCellScope,
  wantsCellScopeOnlyRedo,
  type CellFormatSpecInput,
  type LastLocalCellFormat,
} from "./apply/cell-format";
import {
  detectLocalHelpIntent,
  localHelpMarkdown,
  helpStartMarkdown,
  resolveLocalHelpProfile,
  type LocalHelpKind,
  type LocalHelpProfile,
  detectLocalHelpKindFromHash,
} from "./apply/local-help";
import { downloadVfsFile, normalizeSessionVfsPath, resolveSessionXlsxFile } from "./eai/vfs";
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
  humanizeNetworkError,
  saveUser,
} from "./eai/client";
import { isVfsPathConflictError } from "./eai/vfs";
import { loadCatalog, type CatalogResult } from "./eai/catalog";
import {
  createSession,
  abortSession,
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
import {
  collectProjectionDeliverables,
  getThreadProjection,
  projectionToChatMessages,
  waitForProjectionTurn,
  waitThreadProjection,
} from "./eai/projection";
import { createChatTransport } from "./eai/transport";
import { isAgUiTransport } from "./eai/ag-ui-transport";
import { runAgUiAgent } from "./eai/ag-ui-run";
import { StreamOrchestrator } from "./eai/stream-orchestrator";
import { preferRicherOrAppend } from "./eai/assistant-text-merge";
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
  requestScrollToMessageStart,
  unmountChatView,
  updateStreamingAssistantText,
  type ChatMessage,
} from "./ui/chat";
import { isAssistantWorkingPlaceholder } from "./ui/assistant-working";
import { stripChoiceArtifacts } from "./ui/widget-choice-list";
import { stripUserMessageSupplements } from "./utils/message-text";

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
    onEarlyAnswerReady: () => {
      // Draft already on screen while AG-UI run still waits for RUN_FINISHED
      // (extra tools / long model turns). Drop spinner chrome; keep Stop.
      this.messages = this.messages.filter((m) => m.id !== "local-working");
      if (this.isSending) {
        this.chatStatus = "Ответ на экране — агент завершает ход…";
        this.lastChatPaintKey = "";
        this.renderChatShell(this.chatStatus, true);
      }
    },
    onFileReferences: (messageId, files) => {
      this.applyEarlyFileReferences(messageId, files);
    },
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
  /** Offline FAQ start bubble already injected for this session. */
  private injectedStartHelp = false;
  private messages: ChatMessage[] = [];
  /** Local user/assistant turns that never hit the server (e.g. Cell format intent). */
  private localOfflineChat: ChatMessage[] = [];
  /** Last successful local cell_format (for agent supplement + cell-scope redo). */
  private lastLocalCellFormat: LastLocalCellFormat | null = null;
  /** Drop offline bubbles once a real server assistant arrives. */
  private clearOfflineChatAfterServerAssistant = false;
  /** Last seen server assistant id — new one drops local help (no slide-down). */
  private lastSeenServerAssistantId: string | null = null;
  private rawHistory: HistoryMessage[] = [];
  /** Last Ladcraft error dialog shown (avoid re-popup on every poll). */
  private lastShownLadcraftErrorId: string | null = null;
  /** Cell action bar: which of several result .xlsx is selected. */
  private selectedXlsxPath: string | null = null;
  private lastXlsxDeliverableFp = "";
  private isSending = false;
  /** After local Cell format apply: do not restart history poll (no server turn). */
  private localFormatAppliedThisSend = false;
  /** Debounce identical user text while a turn is in flight / just finished. */
  private lastSendNorm = "";
  private lastSendAt = 0;
  /** Spreadsheet/document action-bar apply in flight (allow sequential repeats). */
  private actionBusy = false;
  private actionBusySince = 0;
  /** Findings chip apply in flight — no busy banner; blocks only parallel findings clicks. */
  private findingsApplyLock = false;
  /** Stable `${messageId}:actionId` keys after successful document action-bar apply. */
  private appliedActionKeys = new Set<string>();
  /** After «Изменено» flash — hide that action button (e.g. «Все»). */
  private dismissedActionKeys = new Set<string>();
  private actionDismissTimers = new Map<string, ReturnType<typeof setTimeout>>();
  /** Finding ids applied from a proofread message; lets «Все» mean remaining fixes. */
  private appliedFindingIdsByTarget = new Map<string, Set<number>>();
  /** Last executeDocumentApplyPlan: finding ids whose search_replace actually succeeded. */
  private lastApplySuccessfulItemIds: number[] = [];
  /** Last apply: every task missed because text already gone from the document. */
  private lastApplyAllNotFound = false;
  /** Dedupe identical local chat notices within a short window. */
  private lastLocalNoticeText = "";
  private lastLocalNoticeAt = 0;
  private sendTurnToken = 0;
  private cancelledSendToken = 0;
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

      // Greeting before VFS/disk: user sees FAQ header while context uploads.
      this.maybeInjectStartHelp(agentId);
      this.renderChatShell(status);

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
          this.maybeInjectStartHelp(agentId);
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
      this.maybeInjectStartHelp(agentId);
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
    this.localOfflineChat = [];
    this.lastLocalCellFormat = null;
    this.clearOfflineChatAfterServerAssistant = false;
    this.lastSeenServerAssistantId = null;
    this.rawHistory = [];
    this.lastShownLadcraftErrorId = null;
    this.selectedXlsxPath = null;
    this.lastXlsxDeliverableFp = "";
    this.appliedActionKeys = new Set();
    this.clearDismissedActionButtons();
    this.chatReady = false;
    this.firstMessageInSession = true;
    this.injectedStartHelp = false;
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
    this.localOfflineChat = [];
    this.lastLocalCellFormat = null;
    this.clearOfflineChatAfterServerAssistant = false;
    this.lastSeenServerAssistantId = null;
    this.rawHistory = [];
    this.lastShownLadcraftErrorId = null;
    this.selectedXlsxPath = null;
    this.lastXlsxDeliverableFp = "";
    this.appliedActionKeys = new Set();
    this.clearDismissedActionButtons();
    this.firstMessageInSession = true;
    this.injectedStartHelp = false;
    this.lastEditorAttachFileId = null;
    this.boundDocKey = null;
    this.needsEditorRemount = true;
    clearAgentXlsxMatrixCache();
  }

  /** Reload message list from Ladcraft session history. */
  private async syncChatFromServer(agentId?: string): Promise<void> {
    if (!this.sessionId) return;
    try {
      if (this.features.agUiStreaming) {
        await this.loadProjectionFromServer();
      } else {
        await this.loadHistoryFromServer();
      }
    } catch (err) {
      const resolvedAgentId =
        agentId ?? (this.selectedAgentId || getConfig().selectedAgentId);
      if (!resolvedAgentId || !isSessionNotFoundError(err)) throw err;
      await this.recoverStaleSession(resolvedAgentId);
    }
  }

  /** Attach early AG-UI file_references to the assistant bubble (excel buttons). */
  private applyEarlyFileReferences(
    messageId: string,
    files: Array<{
      file_id: string;
      path?: string;
      display_name?: string;
      mime_type?: string;
      file_type?: string;
    }>,
  ): void {
    if (!files.length) return;
    let msg = this.messages.find((m) => m.id === messageId);
    if (!msg) {
      this.upsertStreamingAssistant(messageId);
      msg = this.messages.find((m) => m.id === messageId);
    }
    if (!msg || msg.role !== "assistant") return;
    const prev = msg.fileReferences || [];
    const byId = new Map(prev.map((f) => [f.file_id, f]));
    for (const f of files) {
      if (!f.file_id) continue;
      byId.set(f.file_id, { ...byId.get(f.file_id), ...f });
    }
    msg.fileReferences = Array.from(byId.values());
    if (this.screen === "chat") {
      this.renderChatShell(this.chatStatus);
    }
  }

  /** Post-turn / reopen: projection → chat bubbles + file refs (no v1 history). */
  private async loadProjectionFromServer(minSeq?: number): Promise<void> {
    if (!this.sessionId) return;
    let projection;
    if (minSeq && minSeq > 0) {
      const waited = await waitThreadProjection(this.client, this.sessionId, {
        minSeq,
        attempts: 6,
        delayMs: 700,
      });
      projection = waited.projection;
    } else {
      projection = await getThreadProjection(this.client, this.sessionId);
    }
    // Keep rawHistory empty for AG-UI — deliverables come from fileReferences.
    this.rawHistory = [];
    const serverMessages = projectionToChatMessages(projection);
    this.messages = this.mergeOfflineChat(
      this.mergePreservingStreamedAssistant(
        this.mergePendingOutboundUserMessage(serverMessages),
      ),
    );
    this.reassertWorkingBubbleIfSending();
    this.firstMessageInSession = !this.messages.some((m) => m.role === "user");
    void collectProjectionDeliverables(projection);
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
      if (this.features.agUiStreaming) {
        await this.loadProjectionFromServer();
      } else {
        await this.loadHistoryFromServer();
      }
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

  private currentHelpProfile(): LocalHelpProfile | null {
    const agentId = this.selectedAgentId || getConfig().selectedAgentId;
    return resolveLocalHelpProfile({
      contextFamily: this.currentContextFamily(),
      agentId,
      agentLabel: this.agentLabel,
    });
  }

  /** Offline FAQ header on first open (spreadsheet or LCA). Idempotent. */
  private maybeInjectStartHelp(agentId: string): void {
    if (!this.firstMessageInSession) return;
    const profile = resolveLocalHelpProfile({
      contextFamily: this.currentContextFamily(),
      agentId,
      agentLabel: this.agentLabel,
    });
    if (!profile) return;
    if (this.messages.some((m) => String(m.id || "").startsWith("local-help-start-"))) {
      this.injectedStartHelp = true;
      return;
    }
    // Do not clobber a real dialog.
    if (this.messages.some((m) => m.role === "user")) return;

    this.injectedStartHelp = true;
    // Replace server "help" intro so only plugin FAQ header is shown.
    this.messages = this.messages.filter((m) => this.isLocalHelpMessageId(m.id));
    this.localOfflineChat = this.localOfflineChat.filter((m) =>
      this.isLocalHelpMessageId(m.id),
    );
    const startMsg: ChatMessage = {
      id: `local-help-start-${Date.now()}`,
      role: "assistant",
      text: helpStartMarkdown(profile),
    };
    this.messages = [startMsg, ...this.messages];
    this.rememberOfflineChat(startMsg);
  }

  /**
   * On approval / «исправь …» apply last r7.proposal (or Черновик fallback) via Asc.
   * "needs-proposal" = no fence in last answer → caller must forward turn to agent (visible on site).
   * Spreadsheet: local format intent (topN/extreme/autofit) applies Asc without agent turn.
   * Replace/new-sheet still via action bar / skill deliverables.
   */
  private async tryIntentApplyFromUserText(
    userText: string,
  ): Promise<"applied" | "blocked" | "noop" | "needs-proposal"> {
    if (this.screen !== "chat" || !this.sessionId) return "noop";
    this.enrichAssistantApplyTextFromHistory();

    const help = await this.tryLocalHelp(userText);
    if (help === "applied") return "applied";

    if (this.currentContextFamily() === "spreadsheet") {
      return this.trySpreadsheetLocalFormatIntent(userText);
    }

    const wordFmt = await this.tryWordFormatIntent(userText);
    if (wordFmt !== "noop") return wordFmt;

    // Absorb «шрифт Times New Roman, размер 16» into composer prefs (Word).
    absorbFontHintsFromUserText(userText);

    // «замени их на Y» / «исправь их» → last findings (not literal «их»).
    const pronounPlan = planFindingsPronounReplace(userText, this.messages);
    if (pronounPlan) {
      if (!pronounPlan.tasks.length) {
        this.pushLocalChatNotice(
          pronounPlan.statusHint ||
            "Нет таблицы замечаний для «их». Укажите «замени „X“ на „Y“».",
          { status: "Нужен шаг" },
        );
        return "blocked";
      }
      const pronounResult = await this.executeDocumentApplyPlan(pronounPlan, {
        allowRepeat: true,
      });
      return pronounResult === "skipped" ? "blocked" : pronounResult;
    }

    // Literal «замени A на B» → Asc SearchAndReplace now (Excel-format style).
    const lexicalPlan = planLexicalSearchReplace(userText);
    if (lexicalPlan?.tasks.length) {
      const lexResult = await this.executeDocumentApplyPlan(lexicalPlan, { allowRepeat: true });
      return lexResult === "skipped" ? "blocked" : lexResult;
    }

    // «добавь комментарий к слову X: текст» → Asc locally (no LLM / no MISSING_PROPOSAL).
    const commentPlan = planLocalComment(userText);
    if (commentPlan?.tasks.length) {
      const commentResult = await this.executeDocumentApplyPlan(commentPlan, {
        allowRepeat: true,
      });
      return commentResult === "skipped" ? "blocked" : commentResult;
    }

    const hintPlan = planFindingsBySearchHint(userText, this.messages);
    if (hintPlan) {
      if (!hintPlan.tasks.length) {
        this.pushLocalChatNotice(
          hintPlan.statusHint || "В findings нет такой пары — укажите номер из таблицы.",
          { status: "Нет пары" },
        );
        return "blocked";
      }
      const hintResult = await this.executeDocumentApplyPlan(hintPlan, { allowRepeat: true });
      return hintResult === "skipped" ? "blocked" : hintResult;
    }

    const plan = resolveDocumentApplyPlan(userText, this.messages);
    if (!plan) return "noop";
    if (!plan.tasks.length) {
      if (plan.statusHint && /таблиц[аы] замечаний|замени «/i.test(plan.statusHint)) {
        this.pushLocalChatNotice(plan.statusHint, { status: "Нужен шаг" });
        return "blocked";
      }
      if (plan.source === "missing-proposal") {
        this.chatStatus = plan.statusHint || MISSING_PROPOSAL_STATUS;
        this.renderChatShell(this.chatStatus, true);
        return "needs-proposal";
      }
      if (plan.statusHint) {
        this.pushLocalChatNotice(plan.statusHint, { status: "Нужен шаг" });
        return "blocked";
      }
      return "noop";
    }

    const fix = parseFixIntent(userText);
    const target = fix ? resolveDocumentActionTarget(this.messages) : null;
    let planToApply = plan;
    if (target && fix?.mode === "all") {
      const remaining = this.remainingFindingsPlanForTarget(target, { mode: "all" });
      if (!remaining || !remaining.tasks.length) {
        this.settleFindingsFixButtons(target);
        this.pushLocalChatNotice(
          remaining?.statusHint ||
            "Правописание уже исправлено. Стилистику и логику — «исправь стилистику» / «исправь логику».",
          { status: "Без изменений" },
        );
        return "blocked";
      }
      planToApply = remaining;
    }

    const applyResult = await this.executeDocumentApplyPlan(planToApply, {
      allowRepeat: Boolean(parseFixIntent(userText)),
    });
    if (fix && target && applyResult === "applied") {
      const ids =
        this.lastApplySuccessfulItemIds.length > 0
          ? this.lastApplySuccessfulItemIds
          : planToApply.itemIds || [];
      if (ids.length) this.markFindingIdsApplied(target, ids);
      this.lastChatPaintKey = "";
      this.renderChatShell(this.chatStatus, true);
    }
    return applyResult === "skipped" ? "blocked" : applyResult;
  }

  /** «убери рамку» / «сделай жирным» / «без таблицы» — transform draft or selection. */
  private async tryWordFormatIntent(
    userText: string,
  ): Promise<"applied" | "blocked" | "noop"> {
    const intent = detectWordFormatIntent(userText);
    if (!intent) return "noop";

    const sel = (await getSelectedText()).trim();
    const source = resolveWordFormatSourceMarkdown(this.messages, sel);
    if (!source.trim()) {
      this.chatStatus =
        "Нет текста для оформления — выделите фрагмент или дождитесь черновика";
      this.renderChatShell(this.chatStatus, true);
      return "blocked";
    }

    const plan = planWordFormatTransform(intent.kind, source, {
      hasSelection: Boolean(sel),
    });
    if (!plan?.tasks.length) {
      this.chatStatus = "Нечего менять в оформлении";
      this.renderChatShell(this.chatStatus, true);
      return "blocked";
    }

    const result = await this.executeDocumentApplyPlan(plan, { allowRepeat: true });
    if (result === "applied") {
      // Status-only (canon _new); refine chrome for format intents.
      this.chatStatus = intent.summary;
      this.renderChatShell(this.chatStatus, true);
    }
    return result === "skipped" ? "blocked" : result;
  }

  /** FAQ «что умеешь» / «как работать» — offline markdown, 0 LLM. */
  private async tryLocalHelp(userText: string): Promise<"applied" | "noop"> {
    const profile = this.currentHelpProfile();
    if (!profile) return "noop";
    const kind = detectLocalHelpIntent(userText, profile);
    if (!kind) return "noop";
    await this.pushLocalHelpReply(kind, { rememberUser: true, profile });
    return "applied";
  }

  private showLocalHelpFromHash(href: string): void {
    if (this.screen !== "chat") return;
    const kind = detectLocalHelpKindFromHash(href);
    if (!kind) return;
    const profile = this.currentHelpProfile() || "spreadsheet";
    void this.pushLocalHelpReply(kind, { rememberUser: false, profile });
  }

  /** Link [Как работать](#r7-help-howto) — show howto without a user send. */
  private showLocalHelpHowto(): void {
    this.showLocalHelpFromHash("#r7-help-howto");
  }

  private isLocalHelpMessageId(id: string | undefined): boolean {
    return String(id || "").startsWith("local-help-");
  }

  /**
   * Short assistant bubble in chat (acks / hints). Id `local-notice-*` is skipped by
   * resolveActionTarget — action buttons stay on the last model draft.
   */
  private pushLocalChatNotice(text: string, options?: { status?: string }): void {
    const body = String(text || "").trim();
    if (!body) return;
    // Dedupe identical bubbles (failed apply retries / racing paths).
    const now = Date.now();
    if (body === this.lastLocalNoticeText && now - this.lastLocalNoticeAt < 8_000) {
      if (options?.status) {
        this.chatStatus = options.status;
        this.renderChatShell(this.chatStatus, true);
      }
      return;
    }
    this.lastLocalNoticeText = body;
    this.lastLocalNoticeAt = now;
    const assistantMsg: ChatMessage = {
      id: `local-notice-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      role: "assistant",
      text: body,
    };
    this.messages.push(assistantMsg);
    this.rememberOfflineChat(assistantMsg);
    this.clearOfflineChatAfterServerAssistant = false;
    this.chatStatus = options?.status || "Готово";
    requestScrollToMessageStart(assistantMsg.id);
    this.lastChatPaintKey = "";
    this.renderChatShell(this.chatStatus, true);
  }

  /** Drop previous FAQ bubbles so a new reply overwrites instead of stacking. */
  private removeLocalHelpFromChat(): void {
    this.messages = this.messages.filter((m) => !this.isLocalHelpMessageId(m.id));
    this.localOfflineChat = this.localOfflineChat.filter(
      (m) => !this.isLocalHelpMessageId(m.id),
    );
  }

  private async pushLocalHelpReply(
    kind: LocalHelpKind,
    options: { rememberUser: boolean; profile?: LocalHelpProfile },
  ): Promise<void> {
    this.removeLocalHelpFromChat();
    this.clearLocalWorkingBubble();
    const profile = options.profile || this.currentHelpProfile() || "spreadsheet";
    const text = localHelpMarkdown(kind, profile);
    const assistantMsg: ChatMessage = {
      id: `local-help-${Date.now()}`,
      role: "assistant",
      text,
    };
    this.messages.push(assistantMsg);
    if (options.rememberUser) {
      const userBubble = [...this.messages]
        .reverse()
        .find((m) => m.role === "user" && m.id.startsWith("local-"));
      if (userBubble) this.rememberOfflineChat(userBubble);
    }
    this.rememberOfflineChat(assistantMsg);
    this.chatStatus =
      kind === "howto" ? "Справка: как работать" : "Справка: возможности";
    // Keep help until a *new* server assistant arrives (see mergeOfflineChat).
    this.clearOfflineChatAfterServerAssistant = false;
    this.stopHistorySyncPoll();
    // Same as local format: skip post-send history poll that would re-paint/scroll.
    this.localFormatAppliedThisSend = true;
    requestScrollToMessageStart(assistantMsg.id);
    this.renderChatShell(this.chatStatus, true);
  }

  /** Cell: topN / extreme / autofit from phrase → Asc, no LLM tools. */
  private async trySpreadsheetLocalFormatIntent(
    userText: string,
  ): Promise<"applied" | "blocked" | "noop" | "needs-proposal"> {
    if (this.editorType !== "cell") return "noop";

    let intent = inferCellFormatIntentFromUserText(userText);
    // Redo last format as cells only (no new ranking / color).
    if (
      !intent &&
      this.lastLocalCellFormat?.spec &&
      wantsCellScopeOnlyRedo(userText)
    ) {
      const cellSpec = rebuildSpecAsCellScope(this.lastLocalCellFormat.spec);
      const hdr =
        this.extractHeaderFromFormatSpec(cellSpec) ||
        this.lastLocalCellFormat.summary.match(/«([^»]+)»/)?.[1] ||
        "";
      intent = {
        spec: cellSpec,
        summary: hdr
          ? `Применено: те же условия, только ячейки по «${hdr}»`
          : "Применено: те же условия, только ячейки",
      };
    }
    if (!intent) return "noop";

    this.chatStatus = "Оформляю лист…";
    this.clearLocalWorkingBubble();
    this.renderChatShell(this.chatStatus, true);

    try {
      const ascSummary = await withAction(() => applyCellFormatSpec(intent!.spec));
      const hdrMatch = String(ascSummary || "").match(/hdr:([^|]+)/);
      const matchedHeader = hdrMatch ? hdrMatch[1].trim() : "";
      let text = intent!.summary || "Применено";
      if (matchedHeader && /по «[^»]+»/.test(text)) {
        text = text.replace(/по «[^»]+»/, `по «${matchedHeader}»`);
      } else if (!text.startsWith("Применено")) {
        text = `Применено: ${text}`;
      }

      this.lastLocalCellFormat = {
        summary: text,
        spec: intent!.spec,
        ascSummary: String(ascSummary || ""),
        at: Date.now(),
      };

      const userBubble = [...this.messages]
        .reverse()
        .find((m) => m.role === "user" && m.id.startsWith("local-"));
      const assistantMsg: ChatMessage = {
        id: `local-format-${Date.now()}`,
        role: "assistant",
        text,
      };
      this.messages.push(assistantMsg);
      if (userBubble) this.rememberOfflineChat(userBubble);
      this.rememberOfflineChat(assistantMsg);

      this.chatStatus = text;
      this.needsEditorRemount = true;
      this.localFormatAppliedThisSend = true;
      this.clearOfflineChatAfterServerAssistant = false;
      this.stopHistorySyncPoll();
      this.renderChatShell(this.chatStatus, true);
      return "applied";
    } catch (err) {
      console.warn("[ladcraft-r7_new] local cell_format failed", err);
      this.chatStatus = "Не удалось оформить лист";
      this.renderChatShell(this.chatStatus, true);
      return "blocked";
    }
  }

  private extractHeaderFromFormatSpec(spec: CellFormatSpecInput): string {
    const rules = Array.isArray(spec.rules) ? spec.rules : [];
    for (const rule of rules) {
      const match = (rule.match || {}) as Record<string, unknown>;
      if (match.topN && typeof match.topN === "object") {
        return String((match.topN as { header?: string }).header || "").trim();
      }
      if (match.extreme && typeof match.extreme === "object") {
        return String((match.extreme as { header?: string }).header || "").trim();
      }
      if (typeof match.header === "string") return match.header.trim();
    }
    return "";
  }

  private rememberOfflineChat(msg: ChatMessage): void {
    if (!msg?.id) return;
    if (this.localOfflineChat.some((m) => m.id === msg.id)) return;
    this.localOfflineChat.push({ ...msg });
  }

  private mergeOfflineChat(serverMessages: ChatMessage[]): ChatMessage[] {
    const latestServerAsst = [...serverMessages]
      .reverse()
      .find(
        (m) =>
          m.role === "assistant" &&
          !String(m.id || "").startsWith("local-") &&
          (m.text || "").trim() &&
          !isAssistantWorkingPlaceholder((m.text || "").trim()),
      );
    const latestId = latestServerAsst?.id || null;
    if (latestId && latestId !== this.lastSeenServerAssistantId) {
      const hadPrevious = this.lastSeenServerAssistantId !== null;
      this.lastSeenServerAssistantId = latestId;
      // New agent reply after we already had one in this session → drop FAQ
      // so help does not sit below and "slide down".
      if (hadPrevious) {
        this.localOfflineChat = this.localOfflineChat.filter(
          (m) => !this.isLocalHelpMessageId(m.id),
        );
      }
    } else if (latestId && this.lastSeenServerAssistantId === null) {
      this.lastSeenServerAssistantId = latestId;
    }

    if (!this.localOfflineChat.length) return serverMessages;

    // After a real agent turn, drop ephemeral local bubbles (server history wins).
    if (this.clearOfflineChatAfterServerAssistant) {
      const hasServerAssistant = Boolean(latestServerAsst);
      if (hasServerAssistant) {
        this.localOfflineChat = [];
        this.clearOfflineChatAfterServerAssistant = false;
        return serverMessages;
      }
    }

    const ids = new Set(serverMessages.map((m) => m.id));
    const texts = new Set(
      serverMessages
        .filter((m) => m.role === "user")
        .map((m) => this.normalizeUserBubbleText(m.text)),
    );
    const extra: ChatMessage[] = [];
    for (const m of this.localOfflineChat) {
      if (ids.has(m.id)) continue;
      if (m.role === "user" && texts.has(this.normalizeUserBubbleText(m.text))) {
        continue;
      }
      extra.push(m);
      ids.add(m.id);
    }
    return extra.length ? [...serverMessages, ...extra] : serverMessages;
  }

  private normalizeUserBubbleText(text: string | undefined): string {
    return stripUserMessageSupplements(String(text || ""))
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase();
  }

  /** Action-bar click: same last AI draft as insert; no agent turn. */
  private async handleActionBar(actionId: ActionId): Promise<void> {
    if (this.screen !== "chat" || !this.sessionId) return;
    if (this.actionBusy && this.actionBusySince && Date.now() - this.actionBusySince > 90_000) {
      this.actionBusy = false;
      this.actionBusySince = 0;
    }
    if (this.findingsApplyLock && isFindingsFixActionId(actionId)) {
      this.chatStatus = "Дождитесь завершения предыдущего действия";
      this.renderChatShell(this.chatStatus, true);
      return;
    }
    const spreadsheetActionWhileWaiting =
      this.isSending &&
      this.currentContextFamily() === "spreadsheet" &&
      (actionId === "download_vfs_xlsx" ||
        actionId === "sheet_from_xlsx" ||
        actionId === "paste_xlsx_matrix" ||
        actionId === "replace_active_sheet" ||
        actionId === "download_csv") &&
      Boolean(this.resolveActiveXlsxDeliverable());
    const documentActionWhileWaiting =
      this.isSending &&
      this.currentContextFamily() !== "spreadsheet" &&
      (isFindingsFixActionId(actionId) ||
        actionId === "paste_cursor" ||
        actionId === "paste_end" ||
        actionId === "paste_start" ||
        actionId === "replace_selection" ||
        actionId === "add_comment");
    if (this.isSending && !spreadsheetActionWhileWaiting && !documentActionWhileWaiting) {
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
      await this.downloadAgentVfsFile(item.vfsPath, item.fileName, item.fileId);
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

    const target =
      this.currentContextFamily() === "spreadsheet"
        ? resolveActionTarget(this.messages)
        : resolveDocumentActionTarget(this.messages);
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
          this.chatStatus = "Скачан .html";
        }
        this.renderChatShell(this.chatStatus, true);
      } catch (err) {
        console.warn("[ladcraft-r7_new] download failed", err);
        this.chatStatus = "Не удалось скачать файл";
        this.renderChatShell(this.chatStatus, true);
      }
      return;
    }

    let plan = planFromActionId(actionId, target);
    const fixIntent = fixIntentFromActionId(actionId);
    if (fixIntent) {
      const remaining = this.remainingFindingsPlanForTarget(target, fixIntent);
      if (!remaining || !remaining.tasks.length) {
        this.settleFindingsFixButtons(target);
        this.pushLocalChatNotice(
          remaining?.statusHint ||
            "Правописание уже исправлено. Стилистику и логику — через чат.",
          { status: "Без изменений" },
        );
        return;
      }
      plan = remaining;
    }
    if (!plan || !plan.tasks.length) {
      this.chatStatus = plan?.statusHint || "Действие недоступно для этого ответа";
      this.renderChatShell(this.chatStatus, true);
      return;
    }

    if (fixIntent) {
      this.findingsApplyLock = true;
      // Instant gray on click — no busy banner / no mass-disable of sibling chips.
      this.paintFindingsButtonOptimistic(target, actionId);
      plan = { ...plan, statusHint: "Исправляю…" };
      this.chatStatus = "Исправляю…";
      this.renderChatShell(this.chatStatus, true);
    }
    try {
      const result = await this.executeDocumentApplyPlan(plan, { allowRepeat: true });
      if (fixIntent) {
        // Only real Asc hits settle the chip. Soft-miss → revert + «Не найдено».
        if (result !== "applied") {
          this.revertFindingsButtonOptimistic(target, actionId);
          this.lastChatPaintKey = "";
          this.renderChatShell(
            this.lastApplyAllNotFound
              ? "Не найдено"
              : this.chatStatus || "Не применено",
            true,
          );
          return;
        }
        // Mark the whole clicked scope (category / all / ids), not only Asc hits.
        // Partial timeouts used to leave «Все» purple while the chip went gray+hidden.
        const okIds = (plan.itemIds && plan.itemIds.length > 0
          ? plan.itemIds
          : this.lastApplySuccessfulItemIds
        ).slice();
        this.markFindingIdsApplied(target, okIds);
        // Category chips: gray only (no 2s hide). «Все» dismisses the panel.
        this.markActionButtonApplied(target, actionId, {
          dismiss: actionId === "fix_all",
        });
        const remaining = this.remainingFindingsPlanForTarget(target, { mode: "all" });
        if (!remaining || !remaining.tasks.length) {
          this.chatStatus = "Изменено";
          this.markActionButtonApplied(target, "fix_all", { dismiss: true });
        } else {
          this.chatStatus = `Исправлено ${okIds.length}, осталось ${remaining.tasks.length}`;
        }
        // Always ack after chip settle (status may differ from executeDocumentApplyPlan notice).
        this.pushLocalChatNotice(
          okIds.length
            ? `Готово. Исправлены замены №${okIds.join(", ")}.`
            : "Готово. Замены внесены в документ.",
          { status: this.chatStatus },
        );
        return;
      }
      if (result === "applied" && actionId === "add_comment") {
        this.appliedActionKeys.add(actionTargetKey(target, "add_comment"));
        this.lastChatPaintKey = "";
        this.renderChatShell(this.chatStatus, true);
      } else if (result === "applied") {
        // paste_cursor / replace / end — force repaint so notice + button state stick.
        this.lastChatPaintKey = "";
        this.renderChatShell(this.chatStatus, true);
      }
    } finally {
      if (fixIntent) {
        this.findingsApplyLock = false;
        this.lastChatPaintKey = "";
        this.renderChatShell(this.chatStatus, true);
      }
    }
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
          fileId: item.fileId,
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
  ): Promise<"applied" | "blocked" | "noop" | "skipped"> {
    this.lastApplySuccessfulItemIds = [];
    this.lastApplyAllNotFound = false;
    const allowRepeat = options?.allowRepeat === true;
    const appliedKeys = allowRepeat ? new Set<string>() : this.loadAppliedEditorTaskKeys();
    if (!allowRepeat && planDedupeHit(plan, appliedKeys)) {
      // Status only — do not push a chat bubble (keeps action bar on model draft).
      this.chatStatus =
        "Уже применено ранее — повтор не выполнен. Если нужна другая правка, сформулируйте новый запрос.";
      this.renderChatShell(this.chatStatus, true);
      return "skipped";
    }

    const pendingTasks = allowRepeat
      ? plan.tasks
      : plan.tasks.filter((task) => !appliedKeys.has(taskContentKey(task)));
    if (!pendingTasks.length) {
      if (!allowRepeat) {
        for (const k of plan.dedupeKeys) appliedKeys.add(k);
        this.persistAppliedEditorTaskKeys(appliedKeys);
      }
      this.chatStatus =
        "Уже применено ранее — повтор не выполнен. Если нужна другая правка, сформулируйте новый запрос.";
      this.renderChatShell(this.chatStatus, true);
      return "skipped";
    }

    if (plan.requireSelection) {
      const sel = (await getSelectedText()).trim();
      if (!sel) {
        const isComment = plan.tasks.some((t) => t.type === "add_comment");
        const isReplace = plan.tasks.some((t) => t.type === "replace_selection");
        const notice = isComment
          ? "Выделите в документе слово или фразу для комментария, затем нажмите **Коммент** или напишите «добавь»."
          : isReplace
            ? "Выделите фрагмент в документе, затем нажмите **Заменить** или напишите «замени»."
            : "Выделите фрагмент в документе и повторите действие.";
        this.pushLocalChatNotice(notice, { status: "Нужно выделение" });
        return "blocked";
      }
    }

    this.chatStatus = plan.statusHint || "Вставляю в документ…";
    this.renderChatShell(this.chatStatus, true);

    try {
      // No hard timeout: Promise.race abort left UI «failed» while Asc still applied.
      const result = await applyEditorTasks(this.editorType, pendingTasks);
      if (!result.successfulTasks.length && !result.failed) return "noop";

      if (result.successfulTasks.length) {
        const itemIds = plan.itemIds || [];
        if (itemIds.length === plan.tasks.length) {
          const ok = new Set(
            result.successfulTasks.map((t) => `${t.type}:${JSON.stringify(t.data)}`),
          );
          this.lastApplySuccessfulItemIds = plan.tasks
            .map((t, i) => ({ id: itemIds[i], key: `${t.type}:${JSON.stringify(t.data)}` }))
            .filter((row) => ok.has(row.key))
            .map((row) => row.id);
        } else {
          this.lastApplySuccessfulItemIds = itemIds.slice();
        }
        if (!allowRepeat) {
          for (const task of result.successfulTasks) {
            appliedKeys.add(taskContentKey(task));
          }
          for (const k of plan.dedupeKeys) appliedKeys.add(k);
          this.persistAppliedEditorTaskKeys(appliedKeys);
        }
        this.needsEditorRemount = true;
      }

      if (result.successfulTasks.length) {
        const t0 = result.successfulTasks[0]?.type;
        const ids =
          this.lastApplySuccessfulItemIds.length > 0
            ? this.lastApplySuccessfulItemIds
            : plan.itemIds || [];
        const notice =
          t0 === "replace_selection"
            ? "Готово. Фрагмент заменён в документе."
            : t0 === "search_replace"
              ? ids.length === 1
                ? `Готово. Исправлена замена №${ids[0]}.`
                : ids.length
                  ? `Готово. Исправлены замены №${ids.join(", ")}.`
                  : "Готово. Замены внесены в документ."
              : t0 === "add_comment"
                ? "Готово. Комментарий добавлен."
                : "Готово. Вставлено в документ.";
        // Ack in chat; chrome stays short (resolveActionTarget skips local-notice-*).
        this.pushLocalChatNotice(notice, { status: "Готово" });
      } else if (result.failed) {
        const notFoundErrs = (result.errors || []).filter((e) =>
          /Ничего не найдено/i.test(e),
        );
        const allNotFound =
          notFoundErrs.length > 0 &&
          notFoundErrs.length === (result.errors || []).length &&
          !result.successfulTasks.length;
        const softProposalMiss =
          plan.source === "proposal" &&
          plan.tasks.every((t) => t.type === "search_replace") &&
          !result.successfulTasks.length &&
          (allNotFound || !(result.errors || []).length);
        if (softProposalMiss) {
          this.lastApplyAllNotFound = true;
          // Asc returned 0/void for every needle — do not claim success.
          this.chatStatus = "Не найдено";
          this.renderChatShell(this.chatStatus, true);
        } else if (allNotFound && plan.source === "lexical") {
          const detail = notFoundErrs[0].replace(/^search_replace:\s*/i, "");
          this.pushLocalChatNotice(detail, { status: "Не найдено" });
        } else if (notFoundErrs.length && !result.successfulTasks.length) {
          this.chatStatus = "Нечего заменять";
          this.renderChatShell(this.chatStatus, true);
        } else {
          const firstErr = (result.errors || [])[0] || "";
          this.pushLocalChatNotice(
            firstErr
              ? `Не удалось применить изменение в документе.\n${firstErr}`
              : "Не удалось применить изменение в документе.",
            {
              status: "Ошибка",
            },
          );
        }
      } else if (result.summary) {
        this.pushLocalChatNotice(result.summary, { status: "Готово" });
      }

      if (result.successfulTasks.length) return "applied";
      if (result.failed) return "blocked";
      return "noop";
    } catch (err) {
      console.warn("[ladcraft-r7_agui] intent apply failed", err);
      const raw = err instanceof Error ? err.message : String(err);
      const isCommentFail = pendingTasks.some((t) => t.type === "add_comment");
      if (isCommentFail || /якорь|комментар|Выделите/i.test(raw)) {
        this.pushLocalChatNotice(
          /якорь|не найден/i.test(raw)
            ? `${raw}\n\nВыделите в документе нужное слово или фразу и нажмите **Коммент**.`
            : "Не удалось добавить комментарий. Выделите в документе слово или фразу-якорь и нажмите **Коммент**.",
          { status: "Нужно выделение" },
        );
      } else {
        const detail = (err instanceof Error ? err.message : String(err)).trim();
        this.pushLocalChatNotice(
          detail && /слишком много времени|SearchAndReplace|не найден/i.test(detail)
            ? detail
            : "Не удалось применить изменение в документе.",
          { status: "Ошибка" },
        );
      }
      return "blocked";
    }
  }

  private async tryApplyEditorTasksFromHistory(): Promise<void> {
    if (this.screen !== "chat" || !this.sessionId || this.isSending) return;
    if (this.isServiceFeedbackInFlight) return;

    const appliedKeys = this.loadAppliedEditorTaskKeys();
    const fromChat = collectPendingSearchReplaceFromChat(this.messages, appliedKeys);
    const fromHistory = this.rawHistory.length
      ? collectPendingEditorTasks(this.rawHistory, appliedKeys)
      : [];
    // Proofread findings: only buttons / «исправь…» apply SAR.
    // Auto-applying tool_call search_replace races the chips and spams errors.
    let lastUserText = "";
    for (let i = this.messages.length - 1; i >= 0; i--) {
      if (this.messages[i].role === "user") {
        lastUserText = String(this.messages[i].text || "").trim();
        break;
      }
    }
    const allowAutoSar = isLexicalSearchReplaceIntent(lastUserText);
    const pending: Array<{ messageId: string; task: R7Task }> = [];
    const seen = new Set<string>();
    for (const item of [...fromChat, ...fromHistory]) {
      if (item.task.type === "search_replace" && !allowAutoSar) continue;
      const ck = taskContentKey(item.task);
      if (seen.has(ck) || appliedKeys.has(ck)) continue;
      seen.add(ck);
      pending.push(item);
    }
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

  /**
   * After agent turn on «замени X на Y»: apply findings from the reply immediately.
   */
  private async tryAutoApplyFindingsAfterAgentTurn(userText: string): Promise<void> {
    if (!isLexicalSearchReplaceIntent(userText)) return;
    const plan = resolveFindingsAutoApplyPlan(this.messages, userText);
    if (!plan?.tasks.length) return;
    await this.executeDocumentApplyPlan(plan, { allowRepeat: true });
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
      if (isAgUiTransport(this.chatTransport)) {
        await runAgUiAgent(
          this.client,
          { threadId: this.sessionId, content },
          {},
        );
      } else {
        await sendMessage(this.client, this.sessionId, { content });
      }
    } catch (err) {
      console.warn("[ladcraft-r7_agui] r7.event feedback failed", err);
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
    const pendingNorm = this.normalizeUserBubbleText(pending);
    const alreadyOnServer = serverMessages.some(
      (m) =>
        m.role === "user" && this.normalizeUserBubbleText(m.text) === pendingNorm,
    );
    if (alreadyOnServer) return serverMessages;
    return [
      ...serverMessages,
      {
        id: `local-pending-${pending.length}`,
        role: "user",
        // Never show workbook/snapshot supplements in the bubble.
        text: stripUserMessageSupplements(this.pendingOutboundUserText!),
      },
    ];
  }

  /**
   * Keep SSE-painted assistant body when history/projection sync would rewrite the same bubble.
   * Never shrink a richer local paint to a shorter plain server rewrite — only append missing bits.
   * Widgets / waiting flags still come from the server.
   */
  private mergePreservingStreamedAssistant(serverMessages: ChatMessage[]): ChatMessage[] {
    if (!this.messages.length) return serverMessages;
    const localById = new Map(this.messages.map((m) => [m.id, m]));
    const merged = serverMessages.map((server) => {
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
      const serverApply = (server.applyText || "").trim();
      const localApply = (local.applyText || "").trim();
      const mergedDisplay = preferRicherOrAppend(localText, serverText);
      const mergedApply = preferRicherOrAppend(
        localApply || localText,
        serverApply || serverText,
      );
      return {
        ...server,
        text: mergedDisplay,
        applyText: mergedApply || local.applyText || server.applyText,
        fileReferences: local.fileReferences?.length
          ? local.fileReferences
          : server.fileReferences,
      };
    });

    // Keep locally painted assistant bubbles not yet present in projection
    // (stale sync right after stream RUN_ERROR).
    const serverIds = new Set(merged.map((m) => m.id));
    const extras: ChatMessage[] = [];
    for (const local of this.messages) {
      if (local.role !== "assistant") continue;
      if (serverIds.has(local.id)) continue;
      if (String(local.id || "").startsWith("local-")) continue;
      const text = (local.text || "").trim();
      if (!text || isAssistantWorkingPlaceholder(text)) continue;
      extras.push(local);
      serverIds.add(local.id);
    }
    return extras.length ? [...merged, ...extras] : merged;
  }

  private async loadHistoryFromServer(): Promise<void> {
    if (!this.sessionId) return;
    const history = await getHistoryMessages(this.client, this.sessionId);
    this.rawHistory = history;
    const serverMessages = historyToChatMessages(history, {
      editorType: this.editorType,
    });
    this.messages = this.mergeOfflineChat(
      this.mergePreservingStreamedAssistant(
        this.mergePendingOutboundUserMessage(serverMessages),
      ),
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

  private appliedFindingIdsKey(target: ActionTarget): string {
    // Same content-stable key family as actionTargetKey (survive message id swap).
    const proposal = parseR7Proposal(target.raw);
    if (proposal?.kind === "findings" && proposal.items?.length) {
      const sig = proposal.items
        .map((it) => `${it.id}:${it.search}=>${it.replace}`)
        .join("|");
      return `findings:${hashText(sig)}`;
    }
    return `msg:${String(target.message.id || "")}`;
  }

  private getAppliedFindingIds(target: ActionTarget): Set<number> {
    const key = this.appliedFindingIdsKey(target);
    return this.appliedFindingIdsByTarget.get(key) || new Set<number>();
  }

  private markFindingIdsApplied(
    target: ActionTarget,
    ids: number[],
  ): void {
    if (!ids.length) return;
    const key = this.appliedFindingIdsKey(target);
    const current = new Set(this.appliedFindingIdsByTarget.get(key) || []);
    for (const id of ids) current.add(id);
    this.appliedFindingIdsByTarget.set(key, current);
    this.settleFindingsFixButtons(target);
  }

  /**
   * Gray «Изменено» on Все (+ category chips) when mechanical scope is done,
   * then dismiss the whole findings bar after 2s.
   */
  private settleFindingsFixButtons(target: ActionTarget): void {
    const proposal = parseR7Proposal(target.raw);
    if (proposal?.kind !== "findings" || !proposal.items?.length) return;
    const applied = this.getAppliedFindingIds(target);
    const items = proposal.items;
    const anyTagged = findingsHaveCategoryTags(items);

    const settleScope = anyTagged
      ? items.filter((it) => isMechanicalFindingCategory(it.category))
      : items;

    const mechanicalDone =
      settleScope.length > 0 && settleScope.every((it) => applied.has(it.id));

    if (!anyTagged) {
      if (mechanicalDone) this.markActionButtonApplied(target, "fix_all", { dismiss: true });
      return;
    }

    const categoryActions: { id: ActionId; category: string }[] = [
      { id: "fix_orthography", category: "orthography" },
      { id: "fix_punctuation", category: "punctuation" },
      { id: "fix_grammar", category: "grammar" },
    ];
    for (const { id, category } of categoryActions) {
      const catItems = items.filter(
        (it) => String(it.category || "").toLowerCase() === category,
      );
      if (catItems.length && catItems.every((it) => applied.has(it.id))) {
        // Gray chip; hide only when whole mechanical scope is done (below).
        this.markActionButtonApplied(target, id, { dismiss: false });
      }
    }

    if (mechanicalDone) {
      this.markActionButtonApplied(target, "fix_all", { dismiss: true });
      for (const { id } of categoryActions) {
        this.dismissedActionKeys.add(actionTargetKey(target, id));
      }
    }
  }

  /** Instant gray on click (no dismiss yet — dismiss after Asc success). */
  private paintFindingsButtonOptimistic(
    target: ActionTarget,
    actionId: ActionId,
  ): void {
    const key = actionTargetKey(target, actionId);
    this.appliedActionKeys.add(key);
    if (actionId === "fix_all") {
      for (const id of [
        "fix_orthography",
        "fix_punctuation",
        "fix_grammar",
      ] as ActionId[]) {
        this.dismissedActionKeys.add(actionTargetKey(target, id));
      }
    }
    this.lastChatPaintKey = "";
    this.renderChatShell(this.chatStatus || "Вношу замены…", true);
  }

  private revertFindingsButtonOptimistic(
    target: ActionTarget,
    actionId: ActionId,
  ): void {
    const key = actionTargetKey(target, actionId);
    this.appliedActionKeys.delete(key);
    const prev = this.actionDismissTimers.get(key);
    if (prev) {
      clearTimeout(prev);
      this.actionDismissTimers.delete(key);
    }
    this.dismissedActionKeys.delete(key);
    if (actionId === "fix_all") {
      for (const id of [
        "fix_orthography",
        "fix_punctuation",
        "fix_grammar",
      ] as ActionId[]) {
        const ck = actionTargetKey(target, id);
        this.dismissedActionKeys.delete(ck);
        this.appliedActionKeys.delete(ck);
      }
    }
  }

  /** Gray button; for «Все» also start 2s panel dismiss when dismiss=true. */
  private markActionButtonApplied(
    target: ActionTarget,
    actionId: ActionId,
    options?: { dismiss?: boolean },
  ): void {
    const key = actionTargetKey(target, actionId);
    this.appliedActionKeys.add(key);
    this.lastChatPaintKey = "";
    this.renderChatShell(this.chatStatus || "Изменено", true);
    const dismiss = options?.dismiss === true || (options?.dismiss !== false && actionId === "fix_all");
    if (dismiss) this.scheduleActionButtonDismiss(key, 2000);
  }

  /** @deprecated use markActionButtonApplied — kept for call-site clarity */
  private markFixAllButtonApplied(target: ActionTarget): void {
    this.markActionButtonApplied(target, "fix_all", { dismiss: true });
  }

  private scheduleActionButtonDismiss(key: string, delayMs: number): void {
    const prev = this.actionDismissTimers.get(key);
    if (prev) clearTimeout(prev);
    const timer = setTimeout(() => {
      this.actionDismissTimers.delete(key);
      this.dismissedActionKeys.add(key);
      this.lastChatPaintKey = "";
      this.renderChatShell(this.chatStatus, true);
    }, delayMs);
    this.actionDismissTimers.set(key, timer);
  }

  private clearDismissedActionButtons(): void {
    for (const timer of this.actionDismissTimers.values()) clearTimeout(timer);
    this.actionDismissTimers.clear();
    this.dismissedActionKeys = new Set();
  }

  private remainingFindingsPlanForTarget(
    target: ActionTarget,
    fix: FixIntent = { mode: "all" },
  ): import("./apply/intent-apply").DocumentApplyPlan | null {
    const proposal = parseR7Proposal(target.raw);
    if (proposal?.kind !== "findings" || !proposal.items?.length) return null;
    const applied = this.getAppliedFindingIds(target);
    const remaining = proposal.items.filter((it) => !applied.has(it.id));
    if (!remaining.length) return null;
    const plan = planFromFindingsItems(remaining, fix, proposal.revision);
    if (!plan) return null;
    if (!plan.tasks.length) return plan;
    return plan;
  }

  /**
   * Stream already painted findings/Черновик/proposal — don't block UI on slow projection.
   */
  private isLocalAssistantTurnReady(): boolean {
    const target = resolveActionTarget(this.messages);
    if (!target) return false;
    const proposal = parseR7Proposal(target.raw);
    if (proposal?.kind === "findings" && proposal.items?.length) return true;
    if (proposal?.kind === "blob" && (proposal.text || "").trim()) return true;
    if (resolveInsertableText(target.raw).trim().length >= 40) return true;
    return false;
  }

  private renderChatShell(status: string, force = false): void {
    if (this.screen !== "chat") return;
    this.chatStatus = status;
    const contextStateBefore = this.contextState;
    const contextErrorBefore = this.contextError;

    const paint = (forcePaint = false): void => {
      const diskRef = usesDiskRef(this.currentTransferProfile());
      const xlsxDeliverables = this.syncXlsxDeliverableSelection();
      const family = this.currentContextFamily();
      const actionTarget =
        family === "spreadsheet"
          ? resolveActionTarget(this.messages)
          : resolveDocumentActionTarget(this.messages);
      const paintKey = [
        status,
        this.historyFingerprint(),
        this.isSending,
        this.actionBusy,
        this.chatReady,
        this.contextState,
        this.contextError ?? "",
        this.agentLabel,
        this.editorType,
        actionTarget?.fingerprint ?? "",
        family,
        this.selectedXlsxPath ?? "",
        this.lastXlsxDeliverableFp,
        [...this.appliedActionKeys].join(","),
        [...this.dismissedActionKeys].join(","),
        [...this.appliedFindingIdsByTarget.entries()]
          .map(([k, ids]) => `${k}:${[...ids].sort((a, b) => a - b).join(",")}`)
          .join(";"),
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
          contextFamily: family,
          xlsxDeliverables,
          selectedXlsxPath: this.selectedXlsxPath,
          history: this.rawHistory,
          excludeXlsxPath: this.contextFilePath,
          appliedActionKeys: this.appliedActionKeys,
          dismissedActionKeys: this.dismissedActionKeys,
          appliedFindingIds: actionTarget
            ? this.getAppliedFindingIds(actionTarget)
            : undefined,
          actionBusy: this.actionBusy,
          actionBusyLabel: this.actionBusy
            ? this.chatStatus && /вношу|замен/i.test(this.chatStatus)
              ? this.chatStatus
              : "Вношу замены в документ…"
            : undefined,
        },
        {
          onBack: () => {
            void this.exitChatToShell(true);
          },
          onLogout: () => this.logout(),
          onRefreshContext: () => this.handleRefreshContext(),
          onSend: (text) => this.handleSend(text),
          onCancelSend: () => this.handleCancelSend(),
          onWidgetSubmit: (text) => this.handleSend(text),
          onAction: (actionId) => this.handleActionBar(actionId),
          onSelectXlsx: (vfsPath) => {
            this.selectedXlsxPath = vfsPath;
            this.lastChatPaintKey = "";
            this.chatStatus = `Выбрано: ${vfsPath.split("/").pop() || vfsPath}`;
            this.renderChatShell(this.chatStatus, true);
          },
          onHelpLink: (href) => this.showLocalHelpFromHash(href),
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

  private async downloadAgentVfsFile(
    vfsPath: string,
    fileName: string,
    knownFileId?: string,
  ): Promise<void> {
    if (!this.sessionId) return;
    try {
      let fileId = knownFileId?.trim() || null;
      let outName = fileName;
      if (!fileId) {
        const resolved = await resolveSessionXlsxFile(
          this.client,
          this.sessionId,
          vfsPath,
          { excludePath: this.contextFilePath },
        );
        fileId = resolved?.fileId ?? null;
        outName = resolved?.fileName || fileName;
        if (!fileId && this.contextFilePath && vfsPath.includes(this.contextFileName || "")) {
          fileId = this.contextFileId ?? null;
        }
      }
      if (!fileId) {
        this.chatStatus = "Файл не найден в session VFS";
        this.renderChatShell(this.chatStatus, true);
        return;
      }
      const blob = await downloadVfsFile(this.client, fileId, "original");
      downloadBlob(blob, outName.endsWith(".xlsx") ? outName : `${outName}.xlsx`);
      this.chatStatus = `Скачан ${outName}`;
      this.renderChatShell(this.chatStatus, true);
    } catch (err) {
      console.warn("[ladcraft-r7_agui] vfs download failed", err);
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
    const sendToken = ++this.sendTurnToken;

    const agentId = this.selectedAgentId || getConfig().selectedAgentId;
    if (!agentId) return;

    // Strip false `*.md` suffix from analytics option clicks before local UI + API.
    const cleaned = stripChoiceArtifacts(text);
    if (!cleaned.trim()) return;

    const norm = cleaned.trim().replace(/\s+/g, " ").toLowerCase();
    const now = Date.now();
    // Block double-submit of the same phrase (Enter spam / hang retry).
    if (norm && norm === this.lastSendNorm && now - this.lastSendAt < 8000) {
      console.warn("[ladcraft-r7_new] ignore duplicate send within 8s");
      return;
    }
    this.lastSendNorm = norm;
    this.lastSendAt = now;
    // Keep «Все» / applied findings across «исправь 1, 3» — only reset on a new request.
    const preserveActionState =
      Boolean(parseFixIntent(cleaned)) || isDocumentApplyApproval(cleaned);
    if (!preserveActionState) {
      this.appliedActionKeys.clear();
      this.appliedFindingIdsByTarget.clear();
      this.clearDismissedActionButtons();
    }

    if (
      this.currentContextFamily() !== "spreadsheet" &&
      isRemoveCommentsIntent(cleaned)
    ) {
      const userMsg: ChatMessage = {
        id: `local-${Date.now()}`,
        role: "user",
        text: cleaned,
      };
      this.messages.push(userMsg);
      this.rememberOfflineChat(userMsg);
      this.pendingOutboundUserText = null;
      this.clearOfflineChatAfterServerAssistant = false;
      this.pushLocalChatNotice(
        "Не могу убрать комментарии автоматически: в Desktop R7 нет API удаления комментариев из плагина." +
          "\n\nОткройте панель **Комментарии** в редакторе и удалите их вручную.",
        { status: "Недоступно" },
      );
      return;
    }

    const localCommentPlan =
      this.currentContextFamily() === "spreadsheet" ? null : planLocalComment(cleaned);
    if (localCommentPlan?.tasks.length) {
      const userMsg: ChatMessage = {
        id: `local-${Date.now()}`,
        role: "user",
        text: cleaned,
      };
      this.messages.push(userMsg);
      this.rememberOfflineChat(userMsg);
      this.pendingOutboundUserText = null;
      this.clearOfflineChatAfterServerAssistant = false;
      this.chatStatus = localCommentPlan.statusHint || "Добавляю комментарий…";
      this.renderChatShell(this.chatStatus, true);
      const beforeAck = this.messages.length;
      const result = await this.executeDocumentApplyPlan(localCommentPlan, { allowRepeat: true });
      const hasAck = this.messages
        .slice(beforeAck)
        .some((m) => m.role === "assistant" && /комментар/i.test(m.text || ""));
      if (!hasAck && result !== "blocked") {
        this.pushLocalChatNotice("Готово. Комментарий добавлен.", { status: "Готово" });
      }
      return;
    }

    this.cancelledSendToken = 0;
    this.isSending = true;
    this.localFormatAppliedThisSend = false;
    this.pendingOutboundUserText = cleaned;
    this.chatStatus = "Агент думает…";
    const userMsg: ChatMessage = {
      id: `local-${Date.now()}`,
      role: "user",
      text: cleaned,
    };
    this.messages.push(userMsg);
    // First real user turn: drop welcome FAQ so it never slides under the dialog.
    this.removeLocalHelpFromChat();
    this.injectedStartHelp = true;
    this.firstMessageInSession = false;
    // Survive projection sync until the same phrase appears on the server.
    this.rememberOfflineChat(userMsg);
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
        this.clearOfflineChatAfterServerAssistant = false;
        this.rememberOfflineChat(userMsg);
        this.stopHistorySyncPoll();
        this.clearLocalWorkingBubble();
        this.isSending = false;
        this.renderChatShell(this.chatStatus, true);
        return;
      }

      // No proposal in last answer: forward to Ladcraft so the phrase appears on the site
      // and the agent can regenerate with r7.proposal.
      let outboundText = cleaned;
      if (intentResult === "needs-proposal") {
        outboundText = `${cleaned.trim()}\n\n${MISSING_PROPOSAL_AGENT_NOTE}`;
        this.pendingOutboundUserText = outboundText;
        this.chatStatus = "Готовлю ответ…";
        this.reassertWorkingBubbleIfSending();
        this.renderChatShell(this.chatStatus, true);
      }

      // Tell the agent what local format already applied (row/cell/topN/…).
      outboundText = appendLastLocalFormatSupplement(
        outboundText,
        this.lastLocalCellFormat,
      );
      this.pendingOutboundUserText = outboundText;

      // Real agent turn may overwrite ephemeral «Применено» / FAQ bubbles.
      this.removeLocalHelpFromChat();
      this.clearOfflineChatAfterServerAssistant = true;
      this.teardownStreamTurn();
      this.streamOrchestrator.beginTurn();

      let beforeCount = 0;
      if (!this.features.agUiStreaming) {
        try {
          beforeCount = (await getHistoryMessages(this.client, this.sessionId)).length;
        } catch (err) {
          if (!isSessionNotFoundError(err)) throw err;
          await this.recoverStaleSession(agentId, { preserveMessages: true });
          this.chatStatus = "Создана новая сессия";
          beforeCount = 0;
        }
      } else {
        // AG-UI: verify thread still exists via projection (no v1 history).
        try {
          await getThreadProjection(this.client, this.sessionId!);
        } catch (err) {
          if (!isSessionNotFoundError(err)) throw err;
          await this.recoverStaleSession(agentId, { preserveMessages: true });
          this.chatStatus = "Создана новая сессия";
        }
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
          this.throwIfSendCancelled(sendToken);
        } else if (usesDiskRef(this.currentTransferProfile())) {
          this.applyDiskRefContext();
          this.throwIfSendCancelled(sendToken);
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
            this.throwIfSendCancelled(sendToken);
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
      if (activeSessionId && (this.features.agUiStreaming || this.features.sseStreaming)) {
        this.streamOrchestrator.subscribe(activeSessionId);
      }

      // Free waiting_approval/queued (and leftover analytics run) so follow-up starts.
      this.chatStatus = "Подготовка хода…";
      this.reassertWorkingBubbleIfSending();
      this.renderChatShell(this.chatStatus, true);
      await ensureAgentQueueIdleBeforeSend(this.client, agentId, activeSessionId || "", {
        analyticsReady: hasReadyAnalyticsFromChat(this.messages),
      });
      this.throwIfSendCancelled(sendToken);

      await this.sendUserMessage(outboundText, agentId);
      this.throwIfSendCancelled(sendToken);
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
      const minSeq =
        isAgUiTransport(this.chatTransport) ? this.chatTransport.getLastSeq() : 0;

      let waitingForUser = false;

      if (this.features.agUiStreaming) {
        const projTurn = await waitForProjectionTurn(this.client, this.sessionId!, {
          timeoutMs: waitTimeoutMs,
          pollMs: this.streamOrchestrator.getWaitPollMs(),
          minSeq: minSeq > 0 ? minSeq : undefined,
          isLocallyReady: () => this.isLocalAssistantTurnReady(),
          onProgress: (progress) => {
            if (this.screen !== "chat") return;
            if (this.chatStatus === progress) return;
            this.chatStatus = progress;
            this.renderChatShell(this.chatStatus);
          },
          onPoll: async () => {
            await this.streamOrchestrator.runOnPollSync(async () => {
              const before = this.historyFingerprint();
              await this.syncChatFromServer(agentId);
              if (this.historyFingerprint() !== before) {
                this.renderChatShell(this.chatStatus);
              }
            });
          },
        });
        this.throwIfSendCancelled(sendToken);
        await this.syncChatFromServer(agentId);
        this.throwIfSendCancelled(sendToken);
        if (!projTurn) {
          this.chatStatus = "Ответ задерживается — загружаем из projection…";
          this.renderChatShell(this.chatStatus);
          return;
        }
        waitingForUser = projTurn.waitingForUser;
        if (waitingForUser) {
          this.clearLocalWorkingBubble();
          const last = [...this.messages].reverse().find((m) => m.role === "assistant");
          const hasForm = Boolean(last?.widget || last?.widgetChoices?.length);
          this.chatStatus = hasForm
            ? "Выберите вариант в форме"
            : "Ожидание формы или ответьте текстом";
          this.renderChatShell(this.chatStatus, true);
          return;
        }
      } else {
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
              const hist = await getHistoryMessages(this.client, this.sessionId!);
              const after = hist.length;
              await this.sendUserMessage(outboundText, agentId);
              return after;
            },
          },
        );
        this.throwIfSendCancelled(sendToken);

        if (!turn) {
          await this.syncChatFromServer(agentId);
          this.throwIfSendCancelled(sendToken);
          this.chatStatus = "Ответ задерживается — загружаем из чата…";
          this.renderChatShell(this.chatStatus);
          return;
        }

        const widgetPayload =
          extractWidgetPayload(turn.widget ?? turn.reply) ??
          (turn.widget ? extractWidgetPayload(turn.widget) : null);
        waitingForUser = turn.waitingForUser || Boolean(widgetPayload);

        if (waitingForUser) {
          await this.syncChatFromServer(agentId);
          this.throwIfSendCancelled(sendToken);
          if (widgetPayload) {
            const assistantMsg = this.messages.find((m) => m.id === turn.reply.id);
            if (assistantMsg && !assistantMsg.widget) {
              assistantMsg.widget = { ...widgetPayload, interactive: true };
            }
          }
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
        this.throwIfSendCancelled(sendToken);
      }

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
      const raw = err instanceof Error ? err.message : String(err);
      if (
        this.isSendTokenCancelled(sendToken) ||
        raw === "LC_SEND_CANCELLED" ||
        /aborted/i.test(raw)
      ) {
        // Don't leave an empty chat if the agent already finished on the server.
        const recovered = await this.recoverCompletedReplyAfterInterrupt();
        this.chatStatus = recovered ? "Ответ загружен" : "Остановлено";
        return;
      }
      const msg = humanizeNetworkError(err);
      this.chatStatus = msg;
      if (isVfsNotFoundError(err)) {
        this.contextState = "error";
        this.contextError = msg;
      }
      try {
        await this.syncChatFromServer(agentId);
        // Stream died with "network error" but projection already has the reply —
        // don't leave the chrome stuck on a hard error (request still in chat).
        if (this.hasAssistantReplyForLastUser()) {
          this.chatStatus = /network|связи|timeout|таймаут|fetch/i.test(raw)
            ? "Ответ загружен (связь прерывалась)"
            : "Готово";
        }
      } catch {
        /* keep local messages if history fetch fails */
      }
    } finally {
      const wasCancelled = this.isSendTokenCancelled(sendToken);
      if (this.sendTurnToken !== sendToken) return;
      this.teardownStreamTurn();
      this.clearLocalWorkingBubble();
      this.isSending = false;
      this.pendingOutboundUserText = null;
      this.stopHistorySyncPoll();
      if (this.screen !== "chat") return;
      if (wasCancelled) {
        this.cancelledSendToken = 0;
        if (!this.hasAssistantReplyForLastUser()) {
          await this.recoverCompletedReplyAfterInterrupt();
        }
        this.renderChatShell(this.chatStatus || "Остановлено", true);
        return;
      }

      // Apply r7_* tool results / chat findings to the open document immediately.
      try {
        await this.tryAutoApplyFindingsAfterAgentTurn(cleaned);
      } catch (err) {
        console.warn("[ladcraft-r7_agui] findings auto-apply after send failed", err);
      }
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
      } else if (!this.localFormatAppliedThisSend) {
        this.startHistorySyncPoll(2500);
      }
      this.localFormatAppliedThisSend = false;
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

      if (isAgUiTransport(this.chatTransport)) {
        await this.chatTransport.runMessage({
          threadId: this.sessionId!,
          content: outbound.content,
          fileRefs: outbound.fileRefs,
          attachEditorFile: outbound.attachEditor,
        });
      } else {
        await sendMessage(this.client, this.sessionId!, {
          content: outbound.content,
          fileRefs: outbound.fileRefs,
          attachEditorFile: outbound.attachEditor,
        });
      }

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

  private async handleCancelSend(): Promise<void> {
    if (!this.sessionId || !this.isSending) return;
    const token = this.sendTurnToken;
    this.cancelledSendToken = token;
    this.chatStatus = "Останавливаю запрос…";
    this.renderChatShell(this.chatStatus, true);

    try {
      if (this.chatTransport.cancelActiveRun) {
        await this.chatTransport.cancelActiveRun();
      }
      await abortSession(this.client, this.sessionId);
    } catch (err) {
      console.warn("[ladcraft-r7_agui] cancel send failed", err);
    } finally {
      this.teardownStreamTurn();
      this.clearLocalWorkingBubble();
      this.stopHistorySyncPoll();
      this.isSending = false;
      this.stopChatPoll();
      this.pendingOutboundUserText = null;
      // Agent often finishes while the SSE abort races — pull the completed reply.
      const recovered = await this.recoverCompletedReplyAfterInterrupt();
      if (!recovered) {
        this.pushLocalChatNotice("Запрос остановлен. Можно задать новый.", {
          status: "Остановлено",
        });
      }
    }
  }

  /**
   * After Stop/abort/network drop: projection/history may already have the answer.
   * Without this sync the chat stays on the user bubble only (export shows completed).
   */
  private async recoverCompletedReplyAfterInterrupt(): Promise<boolean> {
    if (!this.sessionId || this.screen !== "chat") return false;
    try {
      const agentId = this.selectedAgentId || getConfig().selectedAgentId;
      await this.syncChatFromServer(agentId || undefined);
    } catch (err) {
      console.warn("[ladcraft-r7_agui] recover reply after interrupt failed", err);
      return false;
    }
    if (!this.hasAssistantReplyForLastUser()) return false;
    this.chatStatus = "Ответ загружен";
    this.lastChatPaintKey = "";
    this.renderChatShell(this.chatStatus, true);
    return true;
  }

  private isSendTokenCancelled(token: number): boolean {
    return token > 0 && this.cancelledSendToken === token;
  }

  private throwIfSendCancelled(token: number): void {
    if (this.isSendTokenCancelled(token)) throw new Error("LC_SEND_CANCELLED");
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
