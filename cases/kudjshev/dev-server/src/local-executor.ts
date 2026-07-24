import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { Script, createContext } from 'node:vm';
import { normalizeToolCodeForStorage } from './skill-builder.js';
import type { SkillStorageApi } from './mocks/skillStorage.js';
import type { LocalVfsApi } from './mocks/vfs.js';

export interface LocalExecutionParams {
	code: string;
	input: unknown;
	skillName: string;
	scriptName: string;
	env: Record<string, string | undefined>;
	skillStorage: SkillStorageApi;
	vfs: LocalVfsApi;
	oauthToken?: string | null;
	telegramChatId?: string | null;
	skillScriptsDir?: string | null;
	userEnvironment?: Record<string, string>;
}

export interface LocalExecutionResult {
	result: unknown;
	logs: string[];
}

type CanonicalSkillHandler = (state: Record<string, unknown>, params: unknown) => Promise<unknown>;

type ParamikoExecConfig = {
	host: string;
	port?: number;
	username: string;
	command: string;
	password?: string;
	privateKey?: string;
	timeoutSeconds?: number;
};

type ParamikoExecResult = {
	ok: boolean;
	exitCode?: number;
	stdout?: string;
	stderr?: string;
	error?: string;
};

function execParamikoRunner(runnerPath: string, config: ParamikoExecConfig): Promise<ParamikoExecResult> {
	// Prefer explicit PYTHON_PATH, otherwise use Windows Python Launcher (`py`).
	// `python` might not be in PATH on Windows, but `py` usually is.
	const pythonCmd = process.env.PYTHON_PATH?.trim() || 'py';
	return new Promise((resolve) => {
		const proc = spawn(pythonCmd, [runnerPath], { stdio: ['pipe', 'pipe', 'pipe'] });
		let stdout = '';
		let stderr = '';
		proc.stdout.on('data', (chunk: Buffer | string) => {
			stdout += String(chunk);
		});
		proc.stderr.on('data', (chunk: Buffer | string) => {
			stderr += String(chunk);
		});
		proc.on('error', (err) => {
			resolve({
				ok: false,
				error: err instanceof Error ? err.message : 'Не удалось запустить Python для paramiko'
			});
		});
		proc.on('close', (code) => {
			const trimmed = stdout.trim();
			if (!trimmed) {
				resolve({
					ok: false,
					error:
						stderr.trim() ||
						`paramiko runner завершился с кодом ${code ?? 'unknown'} без stdout`
				});
				return;
			}
			try {
				const parsed = JSON.parse(trimmed) as ParamikoExecResult;
				resolve(parsed);
			} catch {
				resolve({
					ok: false,
					error: `paramiko runner вернул не-JSON: ${trimmed.slice(0, 200)}`
				});
			}
		});
		proc.stdin.write(JSON.stringify(config));
		proc.stdin.end();
	});
}

function createParamikoSsh(skillScriptsDir: string | null | undefined) {
	const runnerPath = skillScriptsDir ? path.join(skillScriptsDir, '_paramiko_runner.py') : null;
	return {
		exec: async (config: ParamikoExecConfig): Promise<ParamikoExecResult> => {
			if (!runnerPath || !existsSync(runnerPath)) {
				return {
					ok: false,
					error: `Файл paramiko runner не найден: ${runnerPath ?? 'skillScriptsDir не задан'}`
				};
			}
			return execParamikoRunner(runnerPath, config);
		}
	};
}

function toStringMap(
	record: Record<string, string | undefined>
): Record<string, string> {
	return Object.fromEntries(
		Object.entries(record).filter((entry): entry is [string, string] => typeof entry[1] === 'string')
	);
}

export async function executeLocalScript(params: LocalExecutionParams): Promise<LocalExecutionResult> {
	const logs: string[] = [];
	const canonicalCode = normalizeToolCodeForStorage(params.code, null);
	if (!/\basync\s+function\s+handler\s*\(/.test(canonicalCode)) {
		throw new Error(
			`Script "${params.scriptName}" in skill "${params.skillName}" is not canonical: expected async function handler(state, params)`
		);
	}

	const sandboxConsole = {
		log: (...args: unknown[]) => {
			logs.push(args.map((v) => String(v)).join(' '));
		},
		warn: (...args: unknown[]) => {
			logs.push(`[warn] ${args.map((v) => String(v)).join(' ')}`);
		},
		error: (...args: unknown[]) => {
			logs.push(`[error] ${args.map((v) => String(v)).join(' ')}`);
		},
		info: (...args: unknown[]) => {
			logs.push(`[info] ${args.map((v) => String(v)).join(' ')}`);
		},
		debug: (...args: unknown[]) => {
			logs.push(`[debug] ${args.map((v) => String(v)).join(' ')}`);
		}
	};

	const paramikoSsh = createParamikoSsh(params.skillScriptsDir);
	const sandbox: Record<string, unknown> = {
		fetch,
		console: sandboxConsole,
		Math,
		Date,
		JSON,
		Promise,
		URL,
		URLSearchParams,
		FormData: typeof globalThis.FormData !== 'undefined' ? globalThis.FormData : undefined,
		Blob: typeof globalThis.Blob !== 'undefined' ? globalThis.Blob : undefined,
		Buffer,
		setTimeout,
		clearTimeout,
		setInterval,
		clearInterval,
		fs,
		path,
		paramikoSsh
	};
	// Make sure tools can do `globalThis.paramikoSsh`.
	// In Node's VM, `globalThis` points to the context global, so we alias it to the sandbox object.
	sandbox.globalThis = sandbox;

	const vmScript = new Script(
		`${canonicalCode}\n;globalThis.__cursorLadcraftHandler__ = typeof handler === 'function' ? handler : null;`
	);
	const vmContext = createContext(sandbox);
	// Keep backward compatibility: direct `paramikoSsh` access too.
	(vmContext as Record<string, unknown>).paramikoSsh = paramikoSsh;
	const appEnvironment = toStringMap(params.env);
	const capabilityVfs = {
		read: (filePath: string) => params.vfs.read(filePath),
		readFile: (filePath: string) => params.vfs.readFile(filePath),
		write: (filePath: string, content: string) => params.vfs.write(filePath, content),
		writeFile: (filePath: string, content: string) => params.vfs.writeFile(filePath, content),
		list: (dirPath?: string) => params.vfs.list(dirPath),
		listDir: (dirPath?: string) => params.vfs.listDir(dirPath),
		delete: (targetPath: string) => params.vfs.delete(targetPath),
		mkdir: (dirPath: string) => params.vfs.mkdir(dirPath),
		rm: (targetPath: string) => params.vfs.rm(targetPath),
		exists: (targetPath: string) => params.vfs.exists(targetPath),
		isDir: (targetPath: string) => params.vfs.isDir(targetPath)
	};
	const capabilityStorage = {
		get: (key: string) => params.skillStorage.get(key),
		set: (key: string, value: string) => params.skillStorage.set(key, value),
		delete: (key: string) => params.skillStorage.delete(key),
		clear: () => params.skillStorage.clear(),
		getAll: () => params.skillStorage.getAll(),
		Get: (key: string) => params.skillStorage.get(key),
		Set: (key: string, value: string) => params.skillStorage.set(key, value),
		Delete: (key: string) => params.skillStorage.delete(key),
		Clear: () => params.skillStorage.clear(),
		GetAll: () => params.skillStorage.getAll()
	};
	const handlerState = {
		environment: {
			app: appEnvironment,
			user: params.userEnvironment ?? {}
		},
		capabilities: {
			vfs: capabilityVfs,
			skillStorage: capabilityStorage,
			storage: capabilityStorage,
			'key-value-storage': capabilityStorage
		}
	};

	const timeoutMessage = 'Script execution timeout: canonical handler did not finish within 1 minute';
	let timeoutId: ReturnType<typeof setTimeout> | null = null;
	const timeoutPromise = new Promise<never>((_, reject) => {
		timeoutId = setTimeout(() => reject(new Error(timeoutMessage)), 60_000);
	});

	try {
		vmScript.runInContext(vmContext, { timeout: 60_000 });
		const handler = (vmContext as Record<string, unknown>).__cursorLadcraftHandler__;
		if (typeof handler !== 'function') {
			throw new Error(
				`Script "${params.scriptName}" in skill "${params.skillName}" did not expose async function handler(state, params)`
			);
		}
		const result = await Promise.race([
			(handler as CanonicalSkillHandler)(handlerState, params.input),
			timeoutPromise
		]);
		if (timeoutId) {
			clearTimeout(timeoutId);
		}
		return { result, logs };
	} catch (err) {
		if (timeoutId) {
			clearTimeout(timeoutId);
		}
		throw err;
	}
}
