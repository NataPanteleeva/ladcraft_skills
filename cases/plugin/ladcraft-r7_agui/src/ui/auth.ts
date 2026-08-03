import type { EaiClient } from "../eai/client";
import { getStoredUserEmail } from "../eai/client";

/** Signup page — opened by button; URL is not shown in UI. */
const SIGN_UP_URL = "https://app.ladcraft.ru/login?authMode=sign_up";

/** Shown as hint under API URL field only. */
const DEFAULT_API_HINT = "https://api.ladcraft.ru";

export interface AuthViewCallbacks {
  onLogin: (email: string, password: string) => Promise<void>;
  onSaveBaseUrl: (baseUrl: string) => void;
  onPing: () => Promise<{ ok: boolean; message: string }>;
}

/** Render login panel with API URL check and site signup button. */
export function renderAuthView(
  root: HTMLElement,
  client: EaiClient,
  callbacks: AuthViewCallbacks,
  defaults: { baseUrl: string },
): void {
  let error = "";
  let pingMessage = "";
  let pingOk = false;
  let busy = false;
  let showAdvanced = false;
  let baseUrl = defaults.baseUrl.trim().replace(/\/$/, "") || DEFAULT_API_HINT;
  /** Keep typed email across re-renders (password is never re-filled). */
  let emailDraft = getStoredUserEmail();

  const render = () => {
    root.innerHTML = "";
    const panel = el("div", "panel card stack");
    root.appendChild(panel);

    // Login first — API URL is advanced and easy to confuse with signup page
    panel.appendChild(buildLoginForm());

    if (error) {
      const errEl = el("div", "error");
      errEl.textContent = error;
      panel.appendChild(errEl);
    }

    const advancedToggle = elButton("secondary");
    advancedToggle.textContent = showAdvanced ? "Скрыть настройки API" : "Настройки API";
    advancedToggle.disabled = busy;
    advancedToggle.onclick = () => {
      showAdvanced = !showAdvanced;
      render();
    };
    panel.appendChild(advancedToggle);

    if (showAdvanced) {
      const settings = el("div", "stack");
      settings.innerHTML = `
        <label>API URL</label>
        <input id="baseUrl" value="${escapeHtml(baseUrl)}" ${busy ? "disabled" : ""} />
        <p class="muted">Обычно ${escapeHtml(DEFAULT_API_HINT)}. Не вставляйте сюда ссылку регистрации.</p>
      `;
      panel.appendChild(settings);

      const pingRow = el("div", "row");
      const pingBtn = elButton("secondary");
      pingBtn.textContent = "Проверить связь";
      pingBtn.disabled = busy;
      pingBtn.onclick = async () => {
        baseUrl = inputVal("baseUrl") || DEFAULT_API_HINT;
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
    }
  };

  function buildLoginForm(): HTMLElement {
    const form = el("div", "stack");
    form.innerHTML = `
      <label>Email</label>
      <input id="email" type="email" value="${escapeHtml(emailDraft)}" ${busy ? "disabled" : ""} />
      <label>Пароль</label>
      <input id="password" type="password" ${busy ? "disabled" : ""} />
    `;

    const btn = elButton("");
    btn.textContent = busy ? "Вход…" : "Войти";
    btn.disabled = busy;
    btn.onclick = async () => {
      // Read credentials BEFORE any re-render (password inputs are wiped on render)
      error = "";
      emailDraft = inputVal("email");
      const password = inputVal("password");
      const fromInput = (document.getElementById("baseUrl") as HTMLInputElement | null)?.value;
      if (fromInput !== null && fromInput !== undefined) {
        baseUrl = fromInput.trim().replace(/\/$/, "") || baseUrl;
      }
      callbacks.onSaveBaseUrl(baseUrl);
      busy = true;
      render();
      try {
        await callbacks.onLogin(emailDraft, password);
      } catch (e) {
        error = e instanceof Error ? e.message : String(e);
        busy = false;
        render();
      }
    };
    form.appendChild(btn);

    const registerBtn = elButton("secondary");
    registerBtn.textContent = "Регистрация";
    registerBtn.disabled = busy;
    registerBtn.onclick = () => openSignUp();
    form.appendChild(registerBtn);

    return form;
  }

  void client;
  render();
}

/** Open Ladcraft signup without exposing the URL in the UI. */
function openSignUp(): void {
  try {
    const opened = window.open(SIGN_UP_URL, "_blank", "noopener,noreferrer");
    if (opened) return;
  } catch {
    /* fall through */
  }
  const a = document.createElement("a");
  a.href = SIGN_UP_URL;
  a.target = "_blank";
  a.rel = "noopener noreferrer";
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  a.remove();
}

function el(tag: string, className: string): HTMLElement {
  const node = document.createElement(tag);
  if (className) node.className = className;
  return node;
}

function elButton(className: string): HTMLButtonElement {
  const node = document.createElement("button");
  if (className) node.className = className;
  return node;
}

function inputVal(id: string): string {
  return (document.getElementById(id) as HTMLInputElement | null)?.value.trim() ?? "";
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}
