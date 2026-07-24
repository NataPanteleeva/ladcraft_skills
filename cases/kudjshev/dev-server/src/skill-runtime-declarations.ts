export const skillRuntimeDeclarations = `
/** Состояние рантайма для deploy-обёртки async function handler(state, params). */
interface SkillHandlerState {
	environment?: {
		app?: Record<string, unknown>;
		user?: Record<string, unknown>;
	};
	capabilities?: Record<string, unknown>;
	appHost?: string;
	socket?: {
		redirect?(payload: { url: string }): void;
		on?(event: string, handler: (...args: unknown[]) => void): void;
		removeAllListeners?(event: string): void;
		destroy?(): void;
	};
}

declare type RequestInfo = string | URL | Request;
declare class URL {
  constructor(input: string, base?: string);
  href: string;
  toString(): string;
}
declare class URLSearchParams {
  constructor(init?: string | Array<Array<string>> | Record<string, string>);
  append(name: string, value: string): void;
  set(name: string, value: string): void;
  get(name: string): string | null;
  toString(): string;
}
declare interface RequestInit {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
}
declare class Request {}
declare class Response {
  ok: boolean;
  status: number;
  text(): Promise<string>;
  json(): Promise<any>;
}
declare const console: {
  log: (...args: unknown[]) => void;
  error: (...args: unknown[]) => void;
  warn: (...args: unknown[]) => void;
  info: (...args: unknown[]) => void;
};
declare const Buffer: {
  from(input: string | Uint8Array, encoding?: string): Uint8Array;
};
declare function setTimeout(handler: (...args: unknown[]) => void, timeout?: number): unknown;
declare function clearTimeout(id: unknown): void;
declare function fetch(input: RequestInfo, init?: RequestInit): Promise<Response>;
declare const zlib: {
  gunzipSync(buf: Uint8Array): Uint8Array;
  gzipSync(buf: Uint8Array | string): Uint8Array;
  [key: string]: unknown;
};
declare const globalThis: {
  paramikoSsh?: {
    exec(config: {
      host: string;
      port?: number;
      username: string;
      command: string;
      password?: string;
      privateKey?: string;
      timeoutSeconds?: number;
    }): Promise<{
      ok: boolean;
      exitCode?: number;
      stdout?: string;
      stderr?: string;
      error?: string;
    }>;
  };
};
`;
