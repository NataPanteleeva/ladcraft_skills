import type { SuggestedAction } from "../apply/suggested-actions";

/** Render agent-agnostic chat trigger buttons (layer 1 — sends text to agent). */
export function renderSuggestedActions(
  actions: SuggestedAction[],
  onSend: (text: string) => void,
): HTMLElement {
  const host = document.createElement("div");
  host.className = "suggested-actions";

  const title = document.createElement("div");
  title.className = "suggested-actions-title";
  title.textContent = "Действия";
  host.appendChild(title);

  const row = document.createElement("div");
  row.className = "suggested-actions-row";

  for (const action of actions) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = action.primary
      ? "suggested-action-btn primary"
      : "suggested-action-btn";
    button.textContent = action.label;
    button.title = `Отправить в чат: ${action.send}`;
    button.onclick = () => onSend(action.send);
    row.appendChild(button);
  }

  host.appendChild(row);
  return host;
}
