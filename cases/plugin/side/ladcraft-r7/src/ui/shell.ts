import type { CatalogApp, CatalogResult } from "../eai/catalog";
import { getConfig } from "../config";
import { readScrollTop, restoreScrollTop } from "./scroll-preserve";

export interface ShellViewState {
  baseUrl: string;
  connectionStatus: string;
  connectionOk: boolean;
  catalog: CatalogResult | null;
  selectedAgentId: string;
  isLoading: boolean;
}

export interface ShellViewCallbacks {
  onRefresh: () => Promise<void>;
  onSelectAgent: (agentId: string) => void;
  onOpenChat: () => void;
  onLogout: () => void;
}

/** Render shell: connection status and agent picker. */
export function renderShellView(
  root: HTMLElement,
  state: ShellViewState,
  callbacks: ShellViewCallbacks,
): void {
  const prevShellBody = root.querySelector(".shell-body") as HTMLElement | null;
  const prevCatalogList = root.querySelector(".catalog-list") as HTMLElement | null;
  const shellScrollTop = readScrollTop(prevShellBody);
  const catalogScrollTop = readScrollTop(prevCatalogList);

  root.innerHTML = "";
  const panel = el("div", "panel shell-panel");
  root.appendChild(panel);

  const header = el("div", "stack");
  const statusClass = state.connectionOk ? "success" : state.isLoading ? "muted" : "error";
  header.innerHTML = `
    <h3 style="margin:0;font-size:14px">Ladcraft</h3>
    <p class="${statusClass}" style="margin:0">${escapeHtml(state.connectionStatus)}</p>
    <p class="muted" style="margin:0">${escapeHtml(state.baseUrl)}</p>
  `;
  panel.appendChild(header);

  const toolbar = el("div", "toolbar");
  const refreshBtn = document.createElement("button");
  refreshBtn.className = "secondary";
  refreshBtn.textContent = state.isLoading ? "Загрузка..." : "Обновить";
  refreshBtn.disabled = state.isLoading;
  refreshBtn.onclick = () => void callbacks.onRefresh();
  toolbar.appendChild(refreshBtn);

  const logoutBtn = el("button", "secondary");
  logoutBtn.textContent = "Выйти";
  logoutBtn.onclick = () => callbacks.onLogout();
  toolbar.appendChild(logoutBtn);
  panel.appendChild(toolbar);

  const body = el("div", "shell-body card stack");
  panel.appendChild(body);

  if (state.catalog?.errors.length) {
    const errBox = el("div", "stack");
    state.catalog.errors.forEach((msg) => {
      const err = el("div", "error");
      err.textContent = msg;
      errBox.appendChild(err);
    });
    body.appendChild(errBox);
  }

  body.appendChild(buildAgentsSection(state, callbacks));
  body.appendChild(buildManualAgentInput(state, callbacks));

  const openBtn = document.createElement("button");
  openBtn.textContent = "Открыть чат";
  openBtn.disabled = !state.selectedAgentId;
  openBtn.onclick = () => {
    const manual = readManualAgentId();
    if (manual) callbacks.onSelectAgent(manual);
    callbacks.onOpenChat();
  };
  body.appendChild(openBtn);

  if (!state.selectedAgentId) {
    const hint = el("p", "muted");
    hint.textContent = "Выберите агента или введите Agent ID вручную.";
    body.appendChild(hint);
  } else {
    const hint = el("p", "muted");
    hint.textContent = "«Назад» в чате завершает сессию — можно выбрать другого агента.";
    body.appendChild(hint);
  }

  const shellBody = root.querySelector(".shell-body") as HTMLElement | null;
  const catalogList = root.querySelector(".catalog-list") as HTMLElement | null;
  if (shellBody) restoreScrollTop(shellBody, shellScrollTop);
  if (catalogList) restoreScrollTop(catalogList, catalogScrollTop);
}

function buildAgentsSection(
  state: ShellViewState,
  callbacks: ShellViewCallbacks,
): HTMLElement {
  const section = el("div", "stack");
  const title = el("label", "");
  title.textContent = "Агенты";
  section.appendChild(title);

  const agents = state.catalog?.agents ?? [];
  if (!agents.length && !state.isLoading) {
    const empty = el("p", "muted");
    empty.textContent = "Агенты не найдены. Введите ID вручную ниже.";
    section.appendChild(empty);
    return section;
  }

  section.appendChild(
    buildCatalogList(agents, state.selectedAgentId, (id) => callbacks.onSelectAgent(id)),
  );
  return section;
}

function buildManualAgentInput(
  state: ShellViewState,
  callbacks: ShellViewCallbacks,
): HTMLElement {
  const section = el("div", "stack");
  const label = el("label", "");
  label.textContent = "Agent ID (вручную)";
  section.appendChild(label);

  const input = document.createElement("input");
  input.id = "manualAgentId";
  input.placeholder = "UUID агента";
  input.value = state.selectedAgentId || getConfig().selectedAgentId;
  input.oninput = () => callbacks.onSelectAgent(input.value.trim());
  input.onchange = () => callbacks.onSelectAgent(input.value.trim());
  section.appendChild(input);
  return section;
}

function buildCatalogList(
  items: CatalogApp[],
  selectedId: string,
  onSelect: (id: string) => void,
): HTMLElement {
  const list = el("ul", "catalog-list");
  for (const item of items) {
    const li = el("li", `catalog-item${item.id === selectedId ? " selected" : ""}`);
    li.innerHTML = `
      <div class="catalog-item-name">${escapeHtml(item.name)}</div>
      ${item.description ? `<div class="catalog-item-desc">${escapeHtml(item.description)}</div>` : ""}
    `;
    li.onclick = () => onSelect(item.id);
    list.appendChild(li);
  }
  return list;
}

function el(tag: string, className: string): HTMLElement {
  const node = document.createElement(tag);
  if (className) node.className = className;
  return node;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
}

function readManualAgentId(): string {
  return (
    (document.getElementById("manualAgentId") as HTMLInputElement | null)?.value.trim() ?? ""
  );
}
