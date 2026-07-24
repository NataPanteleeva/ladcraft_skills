import { getConfig, saveConfig } from "../config";

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  accessTokenExpired: number;
  refreshTokenExpired: number;
}

export interface AuthUser {
  id: string;
  email: string;
  firstName?: string;
}

const AUTH_KEY = "ladcraft_r7_auth";
const USER_KEY = "ladcraft_r7_user";

export class EaiClient {
  private tokens: AuthTokens | null = null;
  private refreshPromise: Promise<void> | null = null;

  constructor(private getBaseUrl: () => string = () => getConfig().baseUrl) {
    this.tokens = loadTokens();
  }

  /** Returns true when access token is present. */
  isAuthenticated(): boolean {
    return Boolean(this.tokens?.accessToken);
  }

  getTokens(): AuthTokens | null {
    return this.tokens;
  }

  setBaseUrl(baseUrl: string): void {
    saveConfig({ baseUrl });
  }

  /** Login with email and password. */
  async login(email: string, password: string): Promise<AuthUser> {
    const res = await this.request<{ message: string; result: Record<string, unknown> }>(
      "/v1/auth/login",
      { method: "POST", body: { email, password }, auth: false },
    );
    const result = res.result;
    this.persistTokens({
      accessToken: String(result.access_token),
      refreshToken: String(result.refresh_token),
      accessTokenExpired: Number(result.access_token_expired),
      refreshTokenExpired: Number(result.refresh_token_expired),
    });
    const user = (result.user as Record<string, string> | undefined) ?? {};
    return {
      id: user.id ?? "",
      email: user.email ?? email,
      firstName: user.first_name,
    };
  }

  /** Start email registration. */
  async registerStart(email: string, inviteCode?: string): Promise<{ message: string }> {
    const body: Record<string, string> = { email };
    if (inviteCode) body.invite_code = inviteCode;
    return this.request<{ message: string }>("/v1/register", {
      method: "POST",
      body,
      auth: false,
    });
  }

  /** Confirm email token from message. */
  async registerConfirm(token: string): Promise<{ completionToken: string }> {
    const res = await this.request<{ result: { completion_token: string } }>(
      "/v1/register/confirm",
      { method: "POST", body: { token }, auth: false },
    );
    return { completionToken: res.result.completion_token };
  }

  /** Complete registration with password. */
  async registerComplete(
    completionToken: string,
    password: string,
    firstName: string,
  ): Promise<AuthUser> {
    const res = await this.request<{ result: Record<string, unknown> }>(
      "/v1/register/complete",
      {
        method: "POST",
        body: {
          completion_token: completionToken,
          password,
          first_name: firstName,
          accepted_terms: true,
        },
        auth: false,
      },
    );
    const result = res.result;
    this.persistTokens({
      accessToken: String(result.access_token),
      refreshToken: String(result.refresh_token),
      accessTokenExpired: Number(result.access_token_expired),
      refreshTokenExpired: Number(result.refresh_token_expired),
    });
    const user = result.user as Record<string, string> | undefined;
    return {
      id: user?.id ?? "",
      email: user?.email ?? "",
      firstName: user?.first_name,
    };
  }

  logout(): void {
    this.tokens = null;
    localStorage.removeItem(AUTH_KEY);
  }

  /**
   * Verify API reachability. Uses authenticated list when logged in,
   * otherwise checks base URL responds.
   */
  async pingConnection(): Promise<{ ok: boolean; message: string }> {
    const base = this.getBaseUrl().replace(/\/$/, "");
    try {
      if (this.isAuthenticated()) {
        await this.request<{ data?: unknown[] }>(
          "/v1/application/list?type=agent&return_installed=true&limit=1",
        );
        return { ok: true, message: "Подключено" };
      }
      const res = await fetch(`${base}/v1/auth/login`, { method: "OPTIONS" });
      if (res.ok || res.status === 405 || res.status === 400) {
        return { ok: true, message: "Подключено" };
      }
      return { ok: false, message: `HTTP ${res.status}` };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { ok: false, message: msg };
    }
  }

  /** Authenticated fetch with JSON body and token refresh. */
  async request<T>(
    path: string,
    options: {
      method?: string;
      body?: unknown;
      auth?: boolean;
      headers?: Record<string, string>;
      formData?: FormData;
    } = {},
  ): Promise<T> {
    const { method = "GET", body, auth = true, headers = {}, formData } = options;
    if (auth) await this.ensureFreshToken();

    const reqHeaders: Record<string, string> = { ...headers };
    if (auth && this.tokens?.accessToken) {
      reqHeaders.Authorization = `Bearer ${this.tokens.accessToken}`;
    }
    if (body !== undefined && !formData) {
      reqHeaders["Content-Type"] = "application/json";
    }

    const res = await fetch(`${this.getBaseUrl()}${path}`, {
      method,
      headers: reqHeaders,
      body: formData ?? (body !== undefined ? JSON.stringify(body) : undefined),
    });

    if (!res.ok) {
      let message = res.statusText;
      try {
        const err = (await res.json()) as { message?: string };
        if (err.message) message = err.message;
      } catch {
        /* ignore */
      }
      throw new Error(message || `HTTP ${res.status}`);
    }

    if (res.status === 204) return undefined as T;
    const text = await res.text();
    if (!text) return undefined as T;
    return JSON.parse(text) as T;
  }

  /** Authenticated binary download (VFS files, etc.). */
  async fetchBlob(path: string): Promise<Blob> {
    if (this.tokens) await this.ensureFreshToken();

    const headers: Record<string, string> = {};
    if (this.tokens?.accessToken) {
      headers.Authorization = `Bearer ${this.tokens.accessToken}`;
    }

    const res = await fetch(`${this.getBaseUrl()}${path}`, { method: "GET", headers });
    if (!res.ok) {
      let message = res.statusText;
      try {
        const err = (await res.json()) as { message?: string };
        if (err.message) message = err.message;
      } catch {
        /* binary or empty */
      }
      throw new Error(message || `HTTP ${res.status}`);
    }
    return res.blob();
  }

  /** API base URL without trailing slash. */
  getApiBaseUrl(): string {
    return this.getBaseUrl().replace(/\/$/, "");
  }

  private async ensureFreshToken(): Promise<void> {
    if (!this.tokens) throw new Error("Не авторизован");
    const now = Date.now();
    const expiresMs = this.tokens.accessTokenExpired * 1000;
    if (now < expiresMs - 60_000) return;

    if (!this.refreshPromise) {
      this.refreshPromise = this.refresh().finally(() => {
        this.refreshPromise = null;
      });
    }
    await this.refreshPromise;
  }

  private async refresh(): Promise<void> {
    if (!this.tokens?.refreshToken) throw new Error("Сессия истекла");
    const res = await fetch(`${this.getBaseUrl()}/v1/auth/refresh`, {
      method: "GET",
      headers: { Authorization: `Bearer ${this.tokens.refreshToken}` },
    });
    if (!res.ok) {
      this.logout();
      throw new Error("Не удалось обновить токен");
    }
    const data = (await res.json()) as { result: Record<string, unknown> };
    const result = data.result;
    this.persistTokens({
      accessToken: String(result.access_token),
      refreshToken: String(result.refresh_token ?? this.tokens.refreshToken),
      accessTokenExpired: Number(result.access_token_expired),
      refreshTokenExpired: Number(
        result.refresh_token_expired ?? this.tokens.refreshTokenExpired,
      ),
    });
  }

  private persistTokens(tokens: AuthTokens): void {
    this.tokens = tokens;
    localStorage.setItem(AUTH_KEY, JSON.stringify(tokens));
  }
}

function loadTokens(): AuthTokens | null {
  try {
    const raw = localStorage.getItem(AUTH_KEY);
    return raw ? (JSON.parse(raw) as AuthTokens) : null;
  } catch {
    return null;
  }
}

export function getStoredUserId(): string {
  try {
    const raw = localStorage.getItem(USER_KEY);
    return raw ? (JSON.parse(raw) as { id: string }).id : "anonymous";
  } catch {
    return "anonymous";
  }
}

export function getStoredUserEmail(): string {
  try {
    const raw = localStorage.getItem(USER_KEY);
    return raw ? (JSON.parse(raw) as { email: string }).email : "";
  } catch {
    return "";
  }
}

export function saveUser(user: AuthUser): void {
  localStorage.setItem(USER_KEY, JSON.stringify(user));
}
