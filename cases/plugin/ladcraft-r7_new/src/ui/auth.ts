import type { EaiClient } from "../eai/client";
import { getStoredUserEmail } from "../eai/client";

export interface AuthViewCallbacks {
  onLogin: (email: string, password: string) => Promise<void>;
  onSaveBaseUrl: (baseUrl: string) => void;
  onPing: () => Promise<{ ok: boolean; message: string }>;
}

/** Render login panel with API URL check. */
export function renderAuthView(
  root: HTMLElement,
  client: EaiClient,
  callbacks: AuthViewCallbacks,
  defaults: { baseUrl: string },
): void {
  let error = "";
  let pingMessage = "";
  let pingOk = false;

  const render = () => {
    root.innerHTML = "";
    const panel = el("div", "panel card stack");
    root.appendChild(panel);

    const settings = el("div", "stack");
    settings.innerHTML = `
      <label>API URL</label>
      <input id="baseUrl" value="${escapeHtml(defaults.baseUrl)}" />
    `;
    panel.appendChild(settings);

    const pingRow = el("div", "row");
    const pingBtn = el("button", "secondary");
    pingBtn.textContent = "Проверить связь";
    pingBtn.onclick = async () => {
      const baseUrl = inputVal("baseUrl");
      error = "";
      pingMessage = "Проверка...";
      pingOk = false;
      callbacks.onSaveBaseUrl(baseUrl);
      render();
      try {
        const res = await callbacks.onPing();
        pingOk = res.ok;
        pingMessage = res.message;
      } catch (e) {
        pingOk = false;
        pingMessage = e instanceof Error ? e.message : String(e);
      }
      render();
    };
    pingRow.appendChild(pingBtn);
    if (pingMessage) {
      const pingEl = el("span", pingOk ? "success" : "error");
      pingEl.textContent = pingMessage;
      pingRow.appendChild(pingEl);
    }
    panel.appendChild(pingRow);

    if (error) {
      const errEl = el("div", "error");
      errEl.textContent = error;
      panel.appendChild(errEl);
    }

    panel.appendChild(buildLoginForm());
  };

  function buildLoginForm(): HTMLElement {
    const form = el("div", "stack");
    const savedEmail = getStoredUserEmail();
    form.innerHTML = `
      <label>Email</label>
      <input id="email" type="email" value="${escapeHtml(savedEmail)}" />
      <label>Пароль</label>
      <input id="password" type="password" />
    `;
    const btn = el("button", "");
    btn.textContent = "Войти";
    btn.onclick = async () => {
      error = "";
      try {
        callbacks.onSaveBaseUrl(inputVal("baseUrl"));
        await callbacks.onLogin(inputVal("email"), inputVal("password"));
      } catch (e) {
        error = e instanceof Error ? e.message : String(e);
        render();
      }
    };
    form.appendChild(btn);
    return form;
  }

  void client;
  render();
}

function el(tag: string, className: string): HTMLElement {
  const node = document.createElement(tag);
  if (className) node.className = className;
  return node;
}

function inputVal(id: string): string {
  return (document.getElementById(id) as HTMLInputElement | null)?.value.trim() ?? "";
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}
