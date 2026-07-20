import type { DocumentContextState } from "../transfer/context-sync";
import type { EditorType } from "../config";
import {
  resolveActionButtons,
  resolveActionTarget,
  type ActionButtonSpec,
  type ActionId,
} from "../apply/action-buttons";
import {
  fillAssistantWorkingBody,
  isAssistantWorkingPlaceholder,
  shouldShowAssistantSpinner,
} from "./assistant-working";
import { paintMarkdownBody, renderMarkdown } from "./markdown";
import { renderWidgetHtml } from "./widget-html";
import { renderWidgetChoiceList } from "./widget-choice-list";
import {
  isNearBottom,
  readScrollTop,
  restoreScrollTop,
  scrollToBottom,
} from "./scroll-preserve";

/** Interactive Ladcraft clarification widget (widget_html from history). */
export interface ChatWidget {
  id?: string;
  name?: string;
  html: string;
  interactive: boolean;
}

const CHAT_VIEW_MARKER = "data-chat-view";

/** Keep scroll at bottom across re-renders unless user scrolled up. */
let stickToBottom = true;
let chatInputDraft = "";
let userIsScrolling = false;
let scrollIdleTimer: ReturnType<typeof setTimeout> | null = null;
/** V4 action panel open state (persists across patch). */
let actionPanelOpen = false;
let lastAutoOpenFingerprint: string | null = null;
/** Top menu panel (nav buttons). */
let chromePanelOpen = false;
/** Top status panel (agent / VFS info). */
let statusPanelOpen = false;
/** Latest chat state for action-tail toggle without stale closure. */
let lastChatState: ChatViewState | null = null;

export interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "system";
  /** Display text (proposal/task fences stripped). */
  text: string;
  /**
   * Raw assistant text for intent-apply (keeps ```r7.proposal```).
   * When absent, apply falls back to `text`.
   */
  applyText?: string;
  widget?: ChatWidget;
  widgetChoices?: string[];
  waitingForInput?: boolean;
}

export type { DocumentContextState } from "../transfer/context-sync";

export interface ChatViewState {
  messages: ChatMessage[];
  status: string;
  isSending: boolean;
  contextState: DocumentContextState;
  contextError?: string;
  agentLabel: string;
  chatReady: boolean;
  /** disk-ref agents use r7-disk id, not session VFS. */
  diskRef?: boolean;
  pluginVersion?: string;
  /** disk-ref diagnostic (id source, Asc.plugin.info keys). */
  diskDebug?: string;
  editorType?: EditorType;
}

export interface ChatViewCallbacks {
  onSend: (text: string) => Promise<void>;
  onWidgetSubmit?: (text: string) => Promise<void>;
  onBack: () => void;
  onLogout: () => void;
  onRefreshContext?: () => Promise<void>;
  /** Local Asc / download from action bar (no agent). */
  onAction?: (actionId: ActionId) => Promise<void>;
}

interface ChatViewContext {
  callbacks: ChatViewCallbacks;
}

const viewContexts = new WeakMap<HTMLElement, ChatViewContext>();

/** Remove chat DOM (e.g. when leaving chat screen). */
export function unmountChatView(root: HTMLElement): void {
  root.innerHTML = "";
}

/** Mount or incrementally update chat UI. */
export function renderChatView(
  root: HTMLElement,
  state: ChatViewState,
  callbacks: ChatViewCallbacks,
): void {
  const shell = root.querySelector(`[${CHAT_VIEW_MARKER}]`) as HTMLElement | null;
  if (shell) {
    patchChatView(shell, state, callbacks);
    return;
  }
  mountChatView(root, state, callbacks);
}

/** Reset scroll stick when opening a new chat session. */
export function resetChatScroll(): void {
  stickToBottom = true;
  chatInputDraft = "";
  userIsScrolling = false;
  actionPanelOpen = false;
  chromePanelOpen = false;
  statusPanelOpen = false;
  lastAutoOpenFingerprint = null;
  if (scrollIdleTimer != null) {
    clearTimeout(scrollIdleTimer);
    scrollIdleTimer = null;
  }
}

/** Patch assistant bubble text without full chat re-render. */
export function updateStreamingAssistantText(
  root: HTMLElement,
  messageId: string,
  text: string,
  options: { finalize?: boolean } = {},
): boolean {
  const shell = root.querySelector(`[${CHAT_VIEW_MARKER}]`) as HTMLElement | null;
  if (!shell) return false;
  const messagesEl = shell.querySelector("[data-chat-messages]") as HTMLElement | null;
  if (!messagesEl) return false;

  const node = messagesEl.querySelector(
    `[data-msg-id="${cssEscape(messageId)}"]`,
  ) as HTMLElement | null;
  if (!node) return false;
  const body = node.querySelector(".message-body") as HTMLElement | null;
  if (!body) return false;

  const streaming = !options.finalize;
  body.replaceChildren();
  if (shouldShowAssistantSpinner(text, streaming)) {
    fillAssistantWorkingBody(body, text);
  } else if (text.trim()) {
    const md = el("div", "message-md");
    body.appendChild(md);
    paintMarkdownBody(md, text);
  }
  node.classList.toggle("message-streaming", streaming);
  node.setAttribute("data-msg-text", text);
  if (stickToBottom && !userIsScrolling) {
    scrollToBottom(messagesEl);
  }
  return true;
}

function mountChatView(
  root: HTMLElement,
  state: ChatViewState,
  callbacks: ChatViewCallbacks,
): void {
  const existingInput = document.getElementById("chatInput") as HTMLTextAreaElement | null;
  if (existingInput) chatInputDraft = existingInput.value;

  const prevMessages = root.querySelector(".chat-messages") as HTMLElement | null;
  const previousScrollTop = readScrollTop(prevMessages);
  if (prevMessages) {
    stickToBottom = isNearBottom(prevMessages);
  }

  root.innerHTML = "";

  const panel = el("div", "panel");
  panel.setAttribute(CHAT_VIEW_MARKER, "1");
  root.appendChild(panel);
  viewContexts.set(panel, { callbacks });

  // Two badges: status (info) + menu (nav buttons) — same pattern as bottom «Действия»
  const chromeWrap = el("div", "chrome-wrap");
  chromeWrap.setAttribute("data-chat-chrome-wrap", "1");

  const menuSlot = el("div", "chrome-slot chrome-slot-menu");
  const chromeTail = document.createElement("button");
  chromeTail.type = "button";
  chromeTail.className = "chrome-tail chrome-tail-menu";
  chromeTail.setAttribute("data-chrome-tail", "1");
  chromeTail.title = "Меню: назад, выход, синхронизация";
  chromeTail.innerHTML = '<span class="action-tail-dot"></span>Меню ▾';
  chromeTail.onclick = (e) => {
    e.preventDefault();
    chromePanelOpen = !chromePanelOpen;
    if (chromePanelOpen) statusPanelOpen = false;
    syncChromePanelsOpen(panel, lastChatState);
  };
  menuSlot.appendChild(chromeTail);

  const chromePanel = el("div", "chrome-slide-panel chrome-menu-panel");
  chromePanel.setAttribute("data-chrome-panel", "1");

  const chrome = el("div", "chrome-compact");
  chrome.setAttribute("data-chat-chrome", "1");

  const backBtn = document.createElement("button");
  backBtn.type = "button";
  backBtn.className = "chrome-ico chrome-ico-back";
  backBtn.title = "Назад";
  backBtn.setAttribute("aria-label", "Назад");
  backBtn.innerHTML =
    '<svg class="chrome-ico-svg chrome-ico-svg-back" viewBox="0 0 24 24" aria-hidden="true">' +
    '<path fill="currentColor" d="M19.5 10.4H8.86l4.47-4.47a1.4 1.4 0 1 0-1.98-1.98L4.4 10.9a1.4 1.4 0 0 0 0 1.98l7.0 6.95a1.4 1.4 0 1 0 1.98-1.98l-4.47-4.45H19.5a1.4 1.4 0 1 0 0-2.8z"/>' +
    "</svg>";
  backBtn.onclick = () => callbacks.onBack();
  chrome.appendChild(backBtn);

  const logoutBtn = document.createElement("button");
  logoutBtn.type = "button";
  logoutBtn.className = "chrome-ico chrome-ico-exit";
  logoutBtn.title = "Выйти";
  logoutBtn.setAttribute("aria-label", "Выйти");
  logoutBtn.innerHTML =
    '<svg class="chrome-ico-svg" viewBox="0 0 24 24" aria-hidden="true">' +
    '<path fill="currentColor" d="M10 3a1 1 0 0 0-1 1v4h2V5h8v14h-8v-3H9v4a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1V4a1 1 0 0 0-1-1H10zm-1.7 7.3L5.6 13H14v2H5.6l2.7 2.7-1.4 1.4L1.8 14l4.8-4.8 1.4 1.4z"/>' +
    "</svg>";
  logoutBtn.onclick = () => callbacks.onLogout();
  chrome.appendChild(logoutBtn);

  if (callbacks.onRefreshContext) {
    const syncBtn = document.createElement("button");
    syncBtn.type = "button";
    syncBtn.className = "chrome-ico sync-btn";
    syncBtn.setAttribute("data-chat-sync", "1");
    syncBtn.title = "Синхр. документ";
    syncBtn.setAttribute("aria-label", "Синхр. документ");
    syncBtn.innerHTML =
      '<svg class="chrome-ico-svg chrome-ico-svg-sync" viewBox="0 0 24 24" fill="none" aria-hidden="true">' +
      '<path stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" ' +
      'd="M20.2 12a8.2 8.2 0 0 0-13.9-5.9M5.2 3.8V8h4.2"/>' +
      '<path stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" ' +
      'd="M3.8 12a8.2 8.2 0 0 0 13.9 5.9M18.8 20.2V16h-4.2"/>' +
      "</svg>";
    syncBtn.onclick = () => void callbacks.onRefreshContext?.();
    chrome.appendChild(syncBtn);
  }

  chromePanel.appendChild(chrome);
  menuSlot.appendChild(chromePanel);
  chromeWrap.appendChild(menuSlot);

  const statusSlot = el("div", "chrome-slot chrome-slot-status");
  const statusTail = document.createElement("button");
  statusTail.type = "button";
  statusTail.className = "chrome-tail chrome-tail-status";
  statusTail.setAttribute("data-status-tail", "1");
  statusTail.title = "Статус";
  statusTail.innerHTML = '<span class="action-tail-dot"></span>Статус ▾';
  statusTail.onclick = (e) => {
    e.preventDefault();
    statusPanelOpen = !statusPanelOpen;
    if (statusPanelOpen) chromePanelOpen = false;
    syncChromePanelsOpen(panel, lastChatState);
  };
  statusSlot.appendChild(statusTail);

  const statusPanel = el("div", "chrome-slide-panel chrome-status-panel");
  statusPanel.setAttribute("data-status-panel", "1");
  const info = el("div", "chrome-info");
  info.setAttribute("data-chat-info", "1");
  const line = el("div", "chrome-line");
  line.setAttribute("data-chat-info-line", "1");
  const detail = el("div", "chrome-detail");
  detail.setAttribute("data-chat-info-detail", "1");
  info.appendChild(line);
  info.appendChild(detail);
  statusPanel.appendChild(info);
  statusSlot.appendChild(statusPanel);
  chromeWrap.appendChild(statusSlot);
  panel.appendChild(chromeWrap);

  const debugBar = el("div", "disk-debug-bar");
  debugBar.setAttribute("data-chat-disk-debug", "1");
  panel.appendChild(debugBar);

  const messagesEl = el("div", "chat-messages");
  messagesEl.setAttribute("data-chat-messages", "1");
  bindMessagesScroll(messagesEl);
  panel.appendChild(messagesEl);

  const inputRow = el("div", "composer-wrap");
  inputRow.setAttribute("data-chat-input-row", "1");

  const actionTail = document.createElement("button");
  actionTail.type = "button";
  actionTail.className = "action-tail";
  actionTail.setAttribute("data-action-tail", "1");
  actionTail.title = "Действия с последним ответом ИИ";
  actionTail.innerHTML = '<span class="action-tail-dot"></span>Действия ▴';
  actionTail.style.display = "none";
  actionTail.onclick = (e) => {
    e.preventDefault();
    actionPanelOpen = !actionPanelOpen;
    const st = lastChatState;
    const ctx = viewContexts.get(panel);
    if (st && ctx) patchActionPanel(panel, st, ctx.callbacks);
  };
  inputRow.appendChild(actionTail);

  const actionPanel = el("div", "action-v4-panel");
  actionPanel.setAttribute("data-action-panel", "1");
  inputRow.appendChild(actionPanel);

  const textarea = document.createElement("textarea");
  textarea.id = "chatInput";
  textarea.onkeydown = (e) => {
    if (e.key === "Escape" && (actionPanelOpen || chromePanelOpen || statusPanelOpen)) {
      if (actionPanelOpen) {
        actionPanelOpen = false;
        const st = lastChatState;
        const ctx = viewContexts.get(panel);
        if (st && ctx) patchActionPanel(panel, st, ctx.callbacks);
      }
      if (chromePanelOpen || statusPanelOpen) {
        chromePanelOpen = false;
        statusPanelOpen = false;
        syncChromePanelsOpen(panel, lastChatState);
      }
      return;
    }
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendBtn.click();
    }
  };

  const sendBtn = document.createElement("button");
  sendBtn.setAttribute("data-chat-send", "1");
  sendBtn.onclick = async () => {
    const text = textarea.value.trim();
    if (!text) return;
    textarea.value = "";
    chatInputDraft = "";
    stickToBottom = true;
    await callbacks.onSend(text);
  };

  inputRow.appendChild(textarea);
  inputRow.appendChild(sendBtn);
  panel.appendChild(inputRow);

  syncMessagesList(messagesEl, state.messages, callbacks);

  patchChrome(panel, state, callbacks);
  applyMessagesScroll(messagesEl, previousScrollTop);
}

function patchChatView(
  shell: HTMLElement,
  state: ChatViewState,
  callbacks: ChatViewCallbacks,
): void {
  const existingInput = document.getElementById("chatInput") as HTMLTextAreaElement | null;
  if (existingInput) chatInputDraft = existingInput.value;

  viewContexts.set(shell, { callbacks });

  const messagesEl = shell.querySelector("[data-chat-messages]") as HTMLElement | null;
  const previousScrollTop = readScrollTop(messagesEl);
  if (messagesEl) {
    stickToBottom = isNearBottom(messagesEl);
  }

  const messagesChanged = messagesEl
    ? syncMessagesList(messagesEl, state.messages, callbacks)
    : false;

  patchChrome(shell, state, callbacks);

  if (messagesEl && messagesChanged) {
    applyMessagesScroll(messagesEl, previousScrollTop);
  }
}

function patchChrome(
  shell: HTMLElement,
  state: ChatViewState,
  callbacks?: ChatViewCallbacks,
): void {
  lastChatState = state;
  const line = shell.querySelector("[data-chat-info-line]");
  const detail = shell.querySelector("[data-chat-info-detail]");
  const shortAgent = shortenAgentLabel(state.agentLabel);
  const ctxNote = formatContextNote(state.contextState, state.contextError, state.diskRef);
  const statusShort = truncateStatus(state.status);
  if (line) {
    line.textContent = `${shortAgent} · ${statusShort}${ctxNote ? ` · ${ctxNote.replace(/^\s*[·•]\s*/, "")}` : ""}`;
  }
  if (detail) {
    const ver = state.pluginVersion ? `v${state.pluginVersion}` : "";
    detail.innerHTML = "";
    const rows = [
      `Агент: ${state.agentLabel}`,
      ver ? `Плагин ${ver}` : "",
      `Статус: ${state.status}`,
      ctxNote ? `Контекст:${ctxNote}` : "",
    ].filter(Boolean);
    for (const row of rows) {
      const p = document.createElement("div");
      p.textContent = row;
      detail.appendChild(p);
    }
  }

  const debugBar = shell.querySelector("[data-chat-disk-debug]");
  if (debugBar) {
    (debugBar as HTMLElement).style.display = "none";
  }

  const syncBtn = shell.querySelector("[data-chat-sync]") as HTMLButtonElement | null;
  if (syncBtn) {
    const title = state.diskRef ? "Обновить контекст" : "Синхр. документ";
    syncBtn.title = title;
    syncBtn.setAttribute("aria-label", title);
    syncBtn.disabled = state.contextState === "syncing" || state.isSending;
    syncBtn.classList.toggle("dirty", state.contextState === "dirty");
    syncBtn.classList.toggle("synced", state.contextState === "synced");
  }

  syncChromePanelsOpen(shell, state);

  const textarea = shell.querySelector("#chatInput") as HTMLTextAreaElement | null;
  if (textarea) {
    textarea.placeholder = state.chatReady
      ? "Сообщение..."
      : state.diskRef
        ? "Готовим контекст диска…"
        : "Готовим документ в VFS…";
    textarea.disabled = !state.chatReady || state.isSending;
    if (document.activeElement !== textarea) {
      textarea.value = chatInputDraft;
    }
  }

  const sendBtn = shell.querySelector("[data-chat-send]") as HTMLButtonElement | null;
  if (sendBtn) {
    sendBtn.textContent = state.isSending ? "Отправка..." : "Отправить";
    sendBtn.disabled = !state.chatReady || state.isSending;
  }

  if (callbacks) patchActionPanel(shell, state, callbacks);
}

function syncChromePanelsOpen(shell: HTMLElement, state: ChatViewState | null): void {
  const statusTail = shell.querySelector("[data-status-tail]") as HTMLElement | null;
  const statusPanel = shell.querySelector("[data-status-panel]") as HTMLElement | null;
  const menuTail = shell.querySelector("[data-chrome-tail]") as HTMLElement | null;
  const menuPanel = shell.querySelector("[data-chrome-panel]") as HTMLElement | null;

  if (statusPanel) statusPanel.classList.toggle("open", statusPanelOpen);
  if (menuPanel) menuPanel.classList.toggle("open", chromePanelOpen);

  if (statusTail) {
    statusTail.classList.toggle("open", statusPanelOpen);
    statusTail.setAttribute("aria-expanded", statusPanelOpen ? "true" : "false");
    const short =
      state != null
        ? `${shortenAgentLabel(state.agentLabel)} · ${truncateStatus(state.status)}`
        : "Статус";
    const arrow = statusPanelOpen ? "▴" : "▾";
    statusTail.innerHTML = `<span class="action-tail-dot"></span>${escapeHtmlLite(short)} ${arrow}`;
    statusTail.title = statusPanelOpen ? "Свернуть статус" : "Показать статус и контекст";
  }

  if (menuTail) {
    menuTail.classList.toggle("open", chromePanelOpen);
    menuTail.setAttribute("aria-expanded", chromePanelOpen ? "true" : "false");
    const dirty = state?.contextState === "dirty";
    const syncing = state?.contextState === "syncing";
    menuTail.classList.toggle("attention", !!dirty || !!syncing);
    const arrow = chromePanelOpen ? "▴" : "▾";
    menuTail.innerHTML = `<span class="action-tail-dot"></span>Меню ${arrow}`;
    menuTail.title = chromePanelOpen
      ? "Свернуть меню"
      : "Меню: назад, выход, синхронизация";
  }
}

function escapeHtmlLite(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function patchActionPanel(
  shell: HTMLElement,
  state: ChatViewState,
  callbacks: ChatViewCallbacks,
): void {
  const editorType = state.editorType || "word";
  const target = resolveActionTarget(state.messages);
  const buttons = resolveActionButtons(target, editorType);

  const tail = shell.querySelector("[data-action-tail]") as HTMLElement | null;
  const panel = shell.querySelector("[data-action-panel]") as HTMLElement | null;
  if (!tail || !panel) return;

  if (!buttons.length) {
    tail.style.display = "none";
    panel.classList.remove("open");
    panel.replaceChildren();
    actionPanelOpen = false;
    lastAutoOpenFingerprint = null;
    return;
  }

  tail.style.display = "";
  const fp = target?.fingerprint || "";
  if (fp && fp !== lastAutoOpenFingerprint) {
    actionPanelOpen = true;
    lastAutoOpenFingerprint = fp;
  }

  panel.classList.toggle("open", actionPanelOpen);
  tail.classList.toggle("open", actionPanelOpen);
  tail.setAttribute("aria-expanded", actionPanelOpen ? "true" : "false");

  const strip = document.createElement("div");
  strip.className = "action-icon-strip";
  for (const btn of buttons) {
    strip.appendChild(buildActionIconButton(btn, callbacks, state));
  }
  panel.replaceChildren(strip);
}

function buildActionIconButton(
  spec: ActionButtonSpec,
  callbacks: ChatViewCallbacks,
  state: ChatViewState,
): HTMLButtonElement {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = spec.primary ? "action-icon-btn primary" : "action-icon-btn";
  btn.title = spec.title;
  btn.setAttribute("data-action-id", spec.id);
  btn.disabled = state.isSending || !state.chatReady;
  const glyph = document.createElement("span");
  glyph.className = "action-icon-glyph";
  glyph.textContent = spec.glyph;
  const label = document.createElement("span");
  label.className = "action-icon-label";
  label.textContent = spec.label;
  btn.appendChild(glyph);
  btn.appendChild(label);
  btn.onclick = () => {
    void callbacks.onAction?.(spec.id);
  };
  return btn;
}

function shortenAgentLabel(label: string): string {
  const t = (label || "Агент").trim();
  if (t.length <= 28) return t;
  if (/LCA/i.test(t)) return "LCA";
  return `${t.slice(0, 26)}…`;
}

function truncateStatus(status: string): string {
  const t = (status || "").trim() || "…";
  return t.length > 36 ? `${t.slice(0, 34)}…` : t;
}

function bindMessagesScroll(messagesEl: HTMLElement): void {
  const markUserScrolling = (): void => {
    userIsScrolling = true;
    if (scrollIdleTimer != null) clearTimeout(scrollIdleTimer);
    scrollIdleTimer = setTimeout(() => {
      userIsScrolling = false;
      scrollIdleTimer = null;
    }, 180);
  };

  messagesEl.addEventListener("wheel", markUserScrolling, { passive: true });
  messagesEl.addEventListener("touchstart", markUserScrolling, { passive: true });
  messagesEl.addEventListener(
    "pointerdown",
    (event) => {
      if (event.pointerType === "mouse") markUserScrolling();
    },
    { passive: true },
  );
  messagesEl.addEventListener(
    "scroll",
    () => {
      markUserScrolling();
      stickToBottom = isNearBottom(messagesEl);
    },
    { passive: true },
  );
}

function applyMessagesScroll(
  messagesEl: HTMLElement,
  previousScrollTop: number,
): void {
  if (stickToBottom && !userIsScrolling) {
    scrollToBottom(messagesEl);
  } else {
    restoreScrollTop(messagesEl, previousScrollTop);
  }
}

function messageFingerprint(m: ChatMessage): string {
  return JSON.stringify({
    role: m.role,
    text: m.text,
    widget: m.widget
      ? { id: m.widget.id, html: m.widget.html, interactive: m.widget.interactive }
      : null,
    choices: m.widgetChoices,
    waiting: m.waitingForInput,
  });
}

/** Sync message list without rebuilding the whole chat shell. Returns true when DOM changed. */
function syncMessagesList(
  container: HTMLElement,
  messages: ChatMessage[],
  callbacks: ChatViewCallbacks,
): boolean {
  const domNodes = Array.from(container.querySelectorAll("[data-msg-id]")) as HTMLElement[];
  const domIds = domNodes.map((n) => n.getAttribute("data-msg-id") ?? "");
  const stateIds = messages.map((m) => m.id);

  const needsRebuild =
    domIds.length !== stateIds.length ||
    domIds.some((id, index) => id !== stateIds[index]);

  if (needsRebuild) {
    container.replaceChildren();
    for (const m of messages) {
      const node = renderMessage(m, callbacks);
      node.setAttribute("data-msg-id", m.id);
      node.setAttribute("data-msg-fp", messageFingerprint(m));
      container.appendChild(node);
    }
    return true;
  }

  let changed = false;
  for (const m of messages) {
    const fp = messageFingerprint(m);
    const node = container.querySelector(`[data-msg-id="${cssEscape(m.id)}"]`) as HTMLElement | null;
    if (!node) continue;
    if (node.getAttribute("data-msg-fp") === fp) continue;

    if (m.role === "assistant" && patchAssistantMessageInPlace(node, m)) {
      node.setAttribute("data-msg-fp", fp);
      changed = true;
      continue;
    }

    const newNode = renderMessage(m, callbacks);
    newNode.setAttribute("data-msg-id", m.id);
    newNode.setAttribute("data-msg-fp", fp);
    node.replaceWith(newNode);
    changed = true;
  }
  return changed;
}

/**
 * Patch assistant markdown without rebuilding the bubble.
 * Widgets / choice lists still require a full replace.
 */
function patchAssistantMessageInPlace(node: HTMLElement, m: ChatMessage): boolean {
  if (m.widget || m.widgetChoices?.length || m.waitingForInput) return false;
  if (node.querySelector(".widget-host, .widget-choice-list, .widget-waiting")) return false;

  const body = node.querySelector(".message-body") as HTMLElement | null;
  if (!body) return false;

  const prevText = node.getAttribute("data-msg-text");
  const nextText = m.text;
  const textChanged = prevText === null || prevText !== nextText;

  if (textChanged) {
    body.querySelector(".agent-working-row")?.remove();
    let md = body.querySelector(".message-md") as HTMLElement | null;
    if (isAssistantWorkingPlaceholder(nextText)) {
      body.querySelector(".message-md")?.remove();
      fillAssistantWorkingBody(body, nextText);
    } else if (nextText.trim()) {
      if (!md) {
        md = el("div", "message-md");
        body.prepend(md);
      }
      paintMarkdownBody(md, nextText);
    } else {
      md?.remove();
    }
    node.setAttribute("data-msg-text", nextText);
  }

  node.classList.remove("message-streaming");
  return true;
}

function cssEscape(value: string): string {
  if (typeof CSS !== "undefined" && "escape" in CSS) {
    return CSS.escape(value);
  }
  return value.replace(/["\\]/g, "\\$&");
}

function renderMessage(m: ChatMessage, callbacks?: ChatViewCallbacks): HTMLElement {
  const node = el("div", `message ${m.role}`);

  if (m.role === "assistant") {
    const body = el("div", "message-body");

    if (m.text.trim()) {
      if (isAssistantWorkingPlaceholder(m.text)) {
        fillAssistantWorkingBody(body, m.text);
      } else {
        body.appendChild(renderMarkdown(m.text));
      }
    }
    node.setAttribute("data-msg-text", m.text);

    if (m.widget) {
      const onSubmit = callbacks?.onWidgetSubmit ?? callbacks?.onSend;
      if (onSubmit) {
        body.appendChild(
          renderWidgetHtml(m.widget, (value) => {
            void onSubmit(value);
          }),
        );
      }
    } else if (m.widgetChoices?.length) {
      const onSubmit = callbacks?.onWidgetSubmit ?? callbacks?.onSend;
      if (onSubmit) {
        body.appendChild(
          renderWidgetChoiceList(m.widgetChoices, (value) => {
            void onSubmit(value);
          }),
        );
      }
    } else if (m.waitingForInput) {
      const hint = el("div", "widget-waiting");
      hint.textContent = "Ожидание формы выбора от сервера… Можно ответить текстом ниже.";
      body.appendChild(hint);
    }

    node.appendChild(body);
  } else {
    const body = el("div", "message-body");
    if (m.text.trim()) {
      body.textContent = m.text;
    }
    node.appendChild(body);
  }

  return node;
}

function formatContextNote(
  state: DocumentContextState,
  error?: string,
  diskRef?: boolean,
): string {
  switch (state) {
    case "synced":
      return diskRef ? " · документ на диске" : " · документ в VFS";
    case "dirty":
      return " · документ изменён или другой файл — синхронизируйте";
    case "syncing":
      return " · синхронизация документа…";
    case "error":
      return ` · ${error ?? "ошибка VFS"}`;
    default:
      return diskRef ? " · без контекста диска" : " · без VFS";
  }
}

function el(tag: string, className: string): HTMLElement {
  const node = document.createElement(tag);
  if (className) node.className = className;
  return node;
}
