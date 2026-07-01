import type { DocumentContextState } from "../transfer/context-sync";
import type { MessageActionPlan } from "../apply";
import { renderMarkdown } from "./markdown";
import { renderWidgetHtml } from "./widget-html";
import { renderWidgetChoiceList } from "./widget-choice-list";
import { createActionHandlers, renderMessageActions, type ActionHandlers } from "./message-actions";
import {
  isNearBottom,
  readScrollTop,
  restoreScrollTop,
  scrollToBottom,
} from "./scroll-preserve";

export { createActionHandlers, type ActionHandlers };

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

export interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "system";
  text: string;
  widget?: ChatWidget;
  widgetChoices?: string[];
  waitingForInput?: boolean;
  actionPlan?: MessageActionPlan;
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
}

export interface ChatViewCallbacks {
  onSend: (text: string) => Promise<void>;
  onWidgetSubmit?: (text: string) => Promise<void>;
  onBack: () => void;
  onLogout: () => void;
  onRefreshContext?: () => Promise<void>;
}

export interface ChatViewOptions {
  actionHandlers?: ActionHandlers;
}

interface ChatViewContext {
  callbacks: ChatViewCallbacks;
  actionHandlers?: ActionHandlers;
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
  options: ChatViewOptions = {},
): void {
  const shell = root.querySelector(`[${CHAT_VIEW_MARKER}]`) as HTMLElement | null;
  if (shell) {
    patchChatView(shell, state, callbacks, options);
    return;
  }
  mountChatView(root, state, callbacks, options);
}

/** Reset scroll stick when opening a new chat session. */
export function resetChatScroll(): void {
  stickToBottom = true;
  chatInputDraft = "";
  userIsScrolling = false;
  if (scrollIdleTimer != null) {
    clearTimeout(scrollIdleTimer);
    scrollIdleTimer = null;
  }
}

function mountChatView(
  root: HTMLElement,
  state: ChatViewState,
  callbacks: ChatViewCallbacks,
  options: ChatViewOptions,
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
  viewContexts.set(panel, { callbacks, actionHandlers: options.actionHandlers });

  const toolbar = el("div", "toolbar");
  const backBtn = el("button", "secondary");
  backBtn.textContent = "Назад";
  backBtn.onclick = () => callbacks.onBack();
  toolbar.appendChild(backBtn);

  const logoutBtn = el("button", "secondary");
  logoutBtn.textContent = "Выйти";
  logoutBtn.onclick = () => callbacks.onLogout();
  toolbar.appendChild(logoutBtn);

  if (callbacks.onRefreshContext) {
    const syncBtn = document.createElement("button");
    syncBtn.className = "secondary sync-btn";
    syncBtn.setAttribute("data-chat-sync", "1");
    syncBtn.onclick = () => void callbacks.onRefreshContext?.();
    toolbar.appendChild(syncBtn);
  }

  panel.appendChild(toolbar);

  const agentBar = el("div", "status-bar");
  agentBar.setAttribute("data-chat-agent", "1");
  panel.appendChild(agentBar);

  const statusBar = el("div", "status-bar");
  statusBar.setAttribute("data-chat-status", "1");
  panel.appendChild(statusBar);

  const messagesEl = el("div", "chat-messages");
  messagesEl.setAttribute("data-chat-messages", "1");
  bindMessagesScroll(messagesEl);
  panel.appendChild(messagesEl);

  const inputRow = el("div", "stack");
  inputRow.setAttribute("data-chat-input-row", "1");

  const textarea = document.createElement("textarea");
  textarea.id = "chatInput";
  textarea.onkeydown = (e) => {
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

  syncMessagesList(messagesEl, state.messages, callbacks, options.actionHandlers);

  patchChrome(panel, state);
  applyMessagesScroll(messagesEl, previousScrollTop);
}

function patchChatView(
  shell: HTMLElement,
  state: ChatViewState,
  callbacks: ChatViewCallbacks,
  options: ChatViewOptions,
): void {
  const existingInput = document.getElementById("chatInput") as HTMLTextAreaElement | null;
  if (existingInput) chatInputDraft = existingInput.value;

  viewContexts.set(shell, { callbacks, actionHandlers: options.actionHandlers });

  const messagesEl = shell.querySelector("[data-chat-messages]") as HTMLElement | null;
  const previousScrollTop = readScrollTop(messagesEl);
  if (messagesEl) {
    stickToBottom = isNearBottom(messagesEl);
  }

  const ctx = viewContexts.get(shell)!;
  const messagesChanged = messagesEl
    ? syncMessagesList(messagesEl, state.messages, ctx.callbacks, ctx.actionHandlers)
    : false;

  patchChrome(shell, state);

  if (messagesEl && messagesChanged) {
    applyMessagesScroll(messagesEl, previousScrollTop);
  }
}

function patchChrome(shell: HTMLElement, state: ChatViewState): void {
  const agentBar = shell.querySelector("[data-chat-agent]");
  if (agentBar) {
    agentBar.textContent = `Агент: ${state.agentLabel}`;
  }

  const statusBar = shell.querySelector("[data-chat-status]");
  if (statusBar) {
    statusBar.textContent = `${state.status}${formatContextNote(state.contextState, state.contextError, state.diskRef)}`;
  }

  const syncBtn = shell.querySelector("[data-chat-sync]") as HTMLButtonElement | null;
  if (syncBtn) {
    syncBtn.textContent = state.diskRef ? "Обновить id документа" : "Синхр. документ";
    syncBtn.disabled = state.contextState === "syncing" || state.isSending;
    syncBtn.classList.toggle("dirty", state.contextState === "dirty");
    syncBtn.classList.toggle("synced", state.contextState === "synced");
  }

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
    actions: m.actionPlan?.blocks.length ?? 0,
  });
}

/** Sync message list without rebuilding the whole chat shell. Returns true when DOM changed. */
function syncMessagesList(
  container: HTMLElement,
  messages: ChatMessage[],
  callbacks: ChatViewCallbacks,
  actionHandlers?: ActionHandlers,
): boolean {
  const domNodes = [...container.querySelectorAll("[data-msg-id]")] as HTMLElement[];
  const domIds = domNodes.map((n) => n.getAttribute("data-msg-id") ?? "");
  const stateIds = messages.map((m) => m.id);

  const needsRebuild =
    domIds.length !== stateIds.length ||
    domIds.some((id, index) => id !== stateIds[index]);

  if (needsRebuild) {
    container.replaceChildren();
    for (const m of messages) {
      const node = renderMessage(m, callbacks, actionHandlers);
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
    const newNode = renderMessage(m, callbacks, actionHandlers);
    newNode.setAttribute("data-msg-id", m.id);
    newNode.setAttribute("data-msg-fp", fp);
    node.replaceWith(newNode);
    changed = true;
  }
  return changed;
}

function cssEscape(value: string): string {
  if (typeof CSS !== "undefined" && "escape" in CSS) {
    return CSS.escape(value);
  }
  return value.replace(/["\\]/g, "\\$&");
}

function renderMessage(
  m: ChatMessage,
  callbacks?: ChatViewCallbacks,
  actionHandlers?: ActionHandlers,
): HTMLElement {
  const node = el("div", `message ${m.role}`);

  if (m.role === "assistant") {
    const body = el("div", "message-body");

    if (m.text.trim()) {
      body.appendChild(renderMarkdown(m.text));
    }

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

    if (actionHandlers && m.actionPlan?.blocks.length) {
      node.appendChild(renderMessageActions(m.actionPlan, actionHandlers));
    }
  } else {
    const body = el("div", "message-body");
    if (m.text.trim()) {
      body.textContent = m.text;
    }
    node.appendChild(body);

    if (actionHandlers && m.actionPlan?.blocks.length) {
      node.appendChild(renderMessageActions(m.actionPlan, actionHandlers));
    }
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
