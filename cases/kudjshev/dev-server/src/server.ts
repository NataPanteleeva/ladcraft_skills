// BUNDLE_MARKER v0.1.1 — prod smoke (server)
import cors from 'cors';
import express from 'express';
import { existsSync, readFileSync, watch } from 'node:fs';
import { mkdir, readFile, rename, rm, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import Handlebars from 'handlebars';
import type { Response as ExpressResponse } from 'express';
import {
	extractAccessToken,
	extractApiErrorMessage,
	extractRefreshToken,
	extractSkillsArray,
	unwrapApiEnvelope
} from './api-payload.js';
import {
	buildCompatibilityAuditMeta,
	CompatibilityAuditManager,
	type SkillCompatibilityReport
} from './compatibility-audit.js';
import { config } from './config.js';
import { executeLocalScript } from './local-executor.js';
import {
	findLocalSkillEntry as findLocalSkillEntryInStore,
	getCanonicalChainStateFileName,
	getCanonicalSkillFolderPath,
	getLegacyChainStateFileName,
	getRemoteCacheFolderPath,
	hasExistingSkillFolder,
	listLocalSkillEntries as listActiveLocalSkillEntries,
	migrateLegacySkillFolder,
	type LocalSkillEntry
} from './local-skill-registry.js';
import { SkillStorageManager } from './mocks/skillStorage.js';
import { createLocalVfs } from './mocks/vfs.js';
import {
	buildLadcraftDeployDiagnostics as buildBuilderLadcraftDeployDiagnostics,
	convertLocalSkillToLadcraftPayload as convertBuilderLocalSkillToLadcraftPayload,
	normalizeLocalSkillPayloadForStorage,
	normalizeToolCodeForStorage
} from './skill-builder.js';
import {
	createPayloadValidationReport,
	type SkillValidationIssue,
	type SkillValidationReport
} from './skill-validation.js';
import { getSkillIdentityKey } from './skill-identity.js';
import { payloadsEqual } from './skill-payload-compare.js';
import { convertFolderToPayloadJson, writeSkillToFolder } from './skill-folder-writer.js';
import { BundleUpdateManager } from './update-manager.js';

const app = express();
app.use((req, _res, next) => {
	console.log(`[dev-server] ${req.method} ${req.url}`);
	next();
});
app.use(cors());
app.use(express.json({ limit: '3mb' }));

const skillStorageManager = new SkillStorageManager(config.skillStorageFile);

const SSE_HEARTBEAT_MS = 25_000;
const SKILLS_WATCH_DEBOUNCE_MS = 500;

const sseClients = new Set<ExpressResponse>();

function writeSseChunk(res: ExpressResponse, event: string, data = '{}'): void {
	res.write(`event: ${event}\ndata: ${data}\n\n`);
}

function broadcastSseEvent(event: 'local-skills-changed' | 'prototype-skills-changed'): void {
	for (const clientRes of sseClients) {
		try {
			writeSseChunk(clientRes, event);
		} catch {
			sseClients.delete(clientRes);
		}
	}
}

function shouldIgnoreSkillsWatchRelativePath(filename: string | null): boolean {
	if (!filename) return false;
	const n = filename.replace(/\\/g, '/');
	return (
		n.includes('/.run-chain/') ||
		n.startsWith('.run-chain/') ||
		n.includes('/.audit/') ||
		n.startsWith('.audit/') ||
		n.includes('/.remote-cache/') ||
		n.startsWith('.remote-cache/') ||
		n.includes('/.legacy-conflicts/') ||
		n.startsWith('.legacy-conflicts/') ||
		n.includes('/.skill-backups/') ||
		n.startsWith('.skill-backups/')
	);
}

function watchSkillsDirectory(
	dir: string,
	event: 'local-skills-changed' | 'prototype-skills-changed'
): void {
	let debounceTimer: NodeJS.Timeout | null = null;
	const schedule = (): void => {
		if (debounceTimer) clearTimeout(debounceTimer);
		debounceTimer = setTimeout(() => {
			debounceTimer = null;
			if (event === 'local-skills-changed') {
				compatibilityAuditManager.schedule();
			}
			broadcastSseEvent(event);
		}, SKILLS_WATCH_DEBOUNCE_MS);
	};
	try {
		watch(dir, { recursive: true }, (eventType, filename) => {
			if (shouldIgnoreSkillsWatchRelativePath(filename)) return;
			schedule();
		});
	} catch (err) {
		console.error(`[dev-server] fs.watch failed for ${dir}:`, err);
	}
}

const vfs = createLocalVfs(config.vfsRoot);
const localSkillsDir = config.localSkillsDir;
const prototypeSkillsDir = config.prototypeSkillsDir;
const remoteCacheDir = path.join(localSkillsDir, '.remote-cache');
const prototypeCacheDir = path.join(prototypeSkillsDir, '.remote-cache');
const chainStateDir = path.join(localSkillsDir, '.run-chain');
const legacyConflictDir = path.join(localSkillsDir, '.legacy-conflicts');
const prototypeLegacyConflictDir = path.join(prototypeSkillsDir, '.legacy-conflicts');
const cursorLadcraftVersionFile = path.join(path.dirname(localSkillsDir), 'VERSION');
const cursorLadcraftRootDir = path.dirname(localSkillsDir);
const devDataDir = path.dirname(config.skillStorageFile);
const bundleUpdateManager = new BundleUpdateManager({
	workspaceRoot: cursorLadcraftRootDir,
	launcherPath: path.join(cursorLadcraftRootDir, 'scripts', 'update-launcher.mjs'),
	statusFilePath: path.join(devDataDir, 'bundle-update-status.json'),
	backupMetaFilePath: path.join(devDataDir, 'bundle-update-last-backup.json')
});
const compatibilityAuditManager = new CompatibilityAuditManager({
	skillsRootPath: localSkillsDir,
	cursorLadcraftRoot: cursorLadcraftRootDir
});

watchSkillsDirectory(localSkillsDir, 'local-skills-changed');
watchSkillsDirectory(prototypeSkillsDir, 'prototype-skills-changed');
type LadcraftEnvironment = 'dev' | 'prod';
type LadcraftEnvCredentials = { access: string; refresh: string };

function emptyLadcraftCreds(): LadcraftEnvCredentials {
	return { access: '', refresh: '' };
}

function parseStoredLadcraftCreds(raw: unknown): LadcraftEnvCredentials {
	if (raw != null && typeof raw === 'object' && !Array.isArray(raw)) {
		const o = raw as Record<string, unknown>;
		const access = String(o.access ?? o.accessToken ?? '').trim();
		const refresh = String(o.refresh ?? o.refreshToken ?? '').trim();
		return { access, refresh };
	}
	const legacy = String(raw ?? '').trim();
	return { access: legacy, refresh: '' };
}

const ladcraftAuthStateFile = path.join(path.dirname(config.skillStorageFile), 'ladcraft-auth.json');
const runtimeCredsByEnv: Record<LadcraftEnvironment, LadcraftEnvCredentials> = {
	dev: emptyLadcraftCreds(),
	prod: emptyLadcraftCreds()
};
let prototypeRuntimeToken = config.prototypeSkilledAgentToken;
let runtimeLadcraftEnv: LadcraftEnvironment = config.ladcraftEnv;
let runtimeSkilledAgentToken = '';

function normalizeLadcraftEnvironment(value: unknown): LadcraftEnvironment {
	return value === 'prod' ? 'prod' : 'dev';
}

function getAuthStatusesByEnv(): Record<LadcraftEnvironment, boolean> {
	return {
		dev: runtimeCredsByEnv.dev.access.trim().length > 0,
		prod: runtimeCredsByEnv.prod.access.trim().length > 0
	};
}

function syncRuntimeTokenFromActiveEnv(): void {
	runtimeSkilledAgentToken = runtimeCredsByEnv[runtimeLadcraftEnv].access;
}

function setLadcraftCredsForEnv(
	environment: LadcraftEnvironment,
	access: string,
	refresh: string
): void {
	runtimeCredsByEnv[environment] = {
		access: access.trim(),
		refresh: refresh.trim()
	};
	if (runtimeLadcraftEnv === environment) {
		syncRuntimeTokenFromActiveEnv();
	}
}

function clearLadcraftCredsForEnv(environment: LadcraftEnvironment): void {
	runtimeCredsByEnv[environment] = emptyLadcraftCreds();
	if (runtimeLadcraftEnv === environment) {
		syncRuntimeTokenFromActiveEnv();
	}
}

function persistLadcraftAuthState(): void {
	const payload = {
		activeEnv: runtimeLadcraftEnv,
		tokensByEnv: {
			dev: runtimeCredsByEnv.dev,
			prod: runtimeCredsByEnv.prod
		}
	};
	void mkdir(path.dirname(ladcraftAuthStateFile), { recursive: true })
		.then(() => writeFile(ladcraftAuthStateFile, JSON.stringify(payload, null, 2), 'utf-8'))
		.catch((err) => {
			console.error('[dev-server] failed to persist ladcraft auth state:', err);
		});
}

function loadLadcraftAuthStateFromDisk(): void {
	if (!existsSync(ladcraftAuthStateFile)) {
		return;
	}
	try {
		const parsed = JSON.parse(readFileSync(ladcraftAuthStateFile, 'utf-8')) as {
			activeEnv?: unknown;
			tokensByEnv?: { dev?: unknown; prod?: unknown };
		};
		runtimeLadcraftEnv = normalizeLadcraftEnvironment(parsed.activeEnv);
		runtimeCredsByEnv.dev = parseStoredLadcraftCreds(parsed.tokensByEnv?.dev);
		runtimeCredsByEnv.prod = parseStoredLadcraftCreds(parsed.tokensByEnv?.prod);
	} catch (err) {
		console.error('[dev-server] failed to load ladcraft auth state:', err);
	}
}

loadLadcraftAuthStateFromDisk();
if (!runtimeCredsByEnv.dev.access && !runtimeCredsByEnv.prod.access) {
	const configuredToken = String(config.skilledAgentToken ?? '').trim();
	if (configuredToken) {
		setLadcraftCredsForEnv(runtimeLadcraftEnv, configuredToken, '');
	}
}
syncRuntimeTokenFromActiveEnv();

function getRuntimeLadcraftConfig() {
	return config.ladcraftEnvironments[runtimeLadcraftEnv];
}

type LocalSkillScript = {
	name: string;
	description?: string;
	input_schema?: Record<string, unknown>;
	output_schema?: Record<string, unknown> | null;
	script_file?: string | null;
	code: string;
	auth?: Record<string, unknown> | null;
	resources?: {
		cpu?: number;
		gpu?: number;
		memory?: number;
		timeout?: number;
		network?: {
			hosts?: string[];
		};
	};
};

type LocalSkillPayload = {
	name: string;
	description: string;
	body: string;
	scripts: LocalSkillScript[];
	widgets: Array<Record<string, unknown>>;
	mcp_spec?: Record<string, unknown> | null;
};

type RemoteSkillRecord = {
	id: number;
	name: string;
	description: string;
	body: string;
	scripts: Array<{
		name: string;
		description?: string;
		input_schema: Record<string, unknown>;
		output_schema: Record<string, unknown> | null;
		script_file: string | null;
		code: string;
		auth: Record<string, unknown> | null;
	}>;
	widgets: Array<{
		id: number;
		name: string;
		description: string;
		schema: Record<string, unknown>;
		template: string;
		scripts?: Array<Record<string, unknown>>;
		external_libraries?: Array<Record<string, unknown>>;
	}>;
	mcp_spec?: Record<string, unknown> | null;
	mcpSpec?: Record<string, unknown> | null;
	tools?: Array<Record<string, unknown>>;
};

type LadcraftApplicationListItem = {
	id: string;
	title?: string;
	name?: string;
	description?: string;
	version?: string;
	installed?: {
		id?: string;
		latest_version?: string;
		installed_version?: string;
	} | null;
	updated_at?: string;
};

type LadcraftApplicationDetails = {
	id: string;
	title?: string;
	name?: string;
	description?: string;
	detailed_description?: string | null;
	skill?: string | null;
	version?: string | null;
	author?: string | null;
	license?: string | null;
	tags?: string[];
	category?: string | null;
	icon?: string | null;
	cover?: string | null;
	tools?: Array<Record<string, unknown>>;
	updated_at?: string;
};

type LadcraftDeployPayload = {
	name: string;
	description: string;
	skill: string;
	version: string;
	author: string;
	license: string;
	tags: string[];
	category: string;
	icon: string;
	cover: string;
	tools: Array<Record<string, unknown>>;
};

type DeployDryRunResult = {
	currentVersion: string;
	targetAction: 'create' | 'update' | 'upsert';
	applicationId: string | null;
	validation: {
		errors: string[];
		warnings: string[];
	};
	validationReport: SkillValidationReport;
	riskSummary: string[];
	diffSummary: {
		skill: string[];
		tools: string[];
		mcpSpecEnvironment: string[];
		widgets: string[];
	};
};

type DeployHistoryEntry = {
	id: number;
	skillName: string;
	createdAt: string;
	mode: 'create' | 'update' | 'upsert';
	/** Устарело: раньше передавалось с клиента; в истории может встречаться у старых записей. */
	bumpType?: 'patch' | 'minor' | 'major';
	/** Локальная заметка; у старых записей из истории может отсутствовать. */
	reason?: string;
	fromVersion: string;
	/** Устарело: следующая версия не вычисляется локально. */
	toVersion?: string;
	applicationId: string | null;
	installedApplicationId: string | null;
	autoInstallStatus: 'updated' | 'installed' | 'skipped' | 'failed' | null;
	status: 'success' | 'failed' | 'conflict' | 'dry_run';
	error: string | null;
};

type InstallationFormValue = string | number | boolean;
type InstallationFormByTool = Record<string, Record<string, InstallationFormValue>>;

function flattenInstallationFormByTool(
	form: InstallationFormByTool | null | undefined
): Record<string, InstallationFormValue> {
	if (!form) return {};
	const flattened: Record<string, InstallationFormValue> = {};
	for (const toolValues of Object.values(form)) {
		const values = asRecord(toolValues);
		if (!values) continue;
		for (const [key, value] of Object.entries(values)) {
			if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
				flattened[key] = value;
			}
		}
	}
	return flattened;
}

type LadcraftCapabilityRequirement = {
	type: string;
	operations: string[];
	scope: '$USER';
};

type LadcraftCapabilityCatalogItem = {
	type: string;
	label?: string;
	description?: string;
	operations: string[];
	operation_descriptions?: Record<string, string>;
	scopes: string[];
};

/**
 * Типы capability должны совпадать с `cls.meta.type` в
 * `backend/services/runtime/infra/capabilities` (key-value-storage, vfs).
 * Старые алиасы Lad Craft (`storage.kv`, `vfs.workspace`) нормализуем при деплое.
 */
function normalizeCapabilityRequirementForRuntime(
	cap: LadcraftCapabilityRequirement
): LadcraftCapabilityRequirement {
	const type = cap.type.trim();
	if (type === 'storage.kv') {
		return {
			type: 'key-value-storage',
			operations: cap.operations.length > 0 ? cap.operations : ['Get', 'Set'],
			scope: '$USER'
		};
	}
	if (type === 'vfs.workspace') {
		const mapOp: Record<string, string> = {
			Read: 'readFile',
			Write: 'writeFile',
			List: 'listDir',
			Mkdir: 'mkdir',
			Delete: 'rm',
			Remove: 'rm',
			Exists: 'exists',
			IsDir: 'isDir'
		};
		const normalizeVfsOp = (operation: string): string => {
			const trimmed = operation.trim();
			if (!trimmed) return '';
			if (mapOp[trimmed]) return mapOp[trimmed];
			const lowered = trimmed.toLowerCase();
			if (lowered === 'readfile') return 'readFile';
			if (lowered === 'writefile') return 'writeFile';
			if (lowered === 'listdir') return 'listDir';
			if (lowered === 'mkdir') return 'mkdir';
			if (lowered === 'rm' || lowered === 'remove' || lowered === 'delete') return 'rm';
			if (lowered === 'exists') return 'exists';
			if (lowered === 'isdir') return 'isDir';
			return trimmed;
		};
		const ops = cap.operations.map(normalizeVfsOp).filter((o) => o.length > 0);
		const defaultVfs = ['readFile', 'writeFile', 'listDir', 'mkdir', 'rm'];
		return {
			type: 'vfs',
			operations: ops.length > 0 ? ops : defaultVfs,
			scope: '$USER'
		};
	}
	return { ...cap, type, scope: '$USER' };
}

type LadcraftDeployDiagnosticLevel = 'error' | 'warn' | 'info';

type LadcraftDeployDiagnosticMessage = {
	level: LadcraftDeployDiagnosticLevel;
	code: string;
	message: string;
};

type LadcraftScriptRuntimeAnalysis = {
	usesSkillStorage: boolean;
	usesVfs: boolean;
	usesGetOAuthToken: boolean;
	usesGetTelegramChatId: boolean;
	usesRequire: boolean;
	usesFs: boolean;
	usesPath: boolean;
	usesBuffer: boolean;
	handlerStyle: 'native-handler' | 'legacy-script-input';
	hasLocalVmBootstrapSuffix: boolean;
	networkHostsInScript: string[];
	capabilitiesRequired: LadcraftCapabilityRequirement[];
	warnings: LadcraftDeployDiagnosticMessage[];
};

type LadcraftWidgetDeployDiagnostics = {
	name: string;
	widgetExternalHosts: string[];
	warnings: LadcraftDeployDiagnosticMessage[];
};

type LadcraftScriptDeployDiagnostics = LadcraftScriptRuntimeAnalysis & {
	name: string;
	widgetName: string | null;
};

type LadcraftDeployDiagnostics = {
	skillName: string;
	scripts: LadcraftScriptDeployDiagnostics[];
	widgets: LadcraftWidgetDeployDiagnostics[];
};

const localSkillPayloadSchema = z.object({
	name: z.string().min(1),
	description: z.string().min(1),
	body: z.string().min(1),
	scripts: z
		.array(
			z.object({
				name: z.string().min(1),
				description: z.string().optional(),
				input_schema: z.record(z.unknown()).optional(),
				output_schema: z.record(z.unknown()).nullable().optional(),
				script_file: z.string().nullable().optional(),
				code: z.string().min(1),
				auth: z.record(z.unknown()).nullable().optional(),
				resources: z
					.object({
						cpu: z.number().finite().optional(),
						gpu: z.number().finite().optional(),
						memory: z.number().finite().optional(),
						timeout: z.number().finite().optional(),
						network: z
							.object({
								hosts: z.array(z.string()).optional()
							})
							.optional()
					})
					.optional()
			})
		)
		.default([]),
	widgets: z.array(z.record(z.unknown())).default([]),
	mcp_spec: z.record(z.unknown()).nullable().optional()
});

const localExecuteSchema = z.object({
	skillName: z.string().optional(),
	scriptName: z.string().optional(),
	code: z.string().optional(),
	input: z.unknown().optional(),
	mocks: z
		.object({
			oauthToken: z.string().optional(),
			telegramChatId: z.string().optional()
		})
		.optional()
});

const localUpsertSchema = z.object({
	skillPayload: localSkillPayloadSchema,
	previousName: z.string().optional()
});

const installationFormValueSchemaRemote = z.union([z.string(), z.number(), z.boolean()]);
const installationFormRecordSchema = z.record(z.string(), installationFormValueSchemaRemote);
const installationFormByToolSchema = z.record(z.string(), installationFormRecordSchema);

const remotePublishSchema = z.object({
	mode: z.enum(['create', 'update']),
	skillId: z.string().min(1).optional(),
	skillPayload: localSkillPayloadSchema,
	installationForm: installationFormByToolSchema.optional()
});

const remoteDeployLocalSchema = z.object({
	skillName: z.string().min(1),
	mode: z.enum(['create', 'update', 'upsert']),
	skillId: z.string().min(1).optional(),
	/** При mode === 'create' — имя для копии на сервере (деплой копии навыка под другим именем). */
	createAsName: z.string().min(1).optional(),
	/** Если передан — деплой из редактора (текущее состояние), иначе чтение из папки по skillName. */
	skillPayload: localSkillPayloadSchema.optional(),
	installationForm: installationFormByToolSchema.optional()
});

const setAuthTokenSchema = z.object({
	token: z.string().min(1)
});

const setLadcraftEnvironmentSchema = z.object({
	environment: z.enum(['dev', 'prod'])
});

const authLoginSchema = z.object({
	email: z.string().email(),
	password: z.string().min(1)
});

const prototypeCopyToLocalSchema = z.object({
	skillName: z.string().min(1),
	targetName: z.string().min(1).optional(),
	overwrite: z.boolean().optional()
});

const acceptServerSchema = z.object({
	skillName: z.string().min(1),
	skillId: z.string().min(1).optional()
});

const installationFormDraftSchema = z.object({
	installationForm: installationFormByToolSchema
});

class DevServerHttpError extends Error {
	status: number;

	constructor(status: number, message: string) {
		super(message);
		this.name = 'DevServerHttpError';
		this.status = status;
	}
}

function sendHttpError(
	res: ExpressResponse,
	error: unknown,
	fallbackMessage: string,
	fallbackStatus = 500
): void {
	if (error instanceof DevServerHttpError) {
		res.status(error.status).json({ ok: false, error: error.message });
		return;
	}
	const message = error instanceof Error ? error.message : fallbackMessage;
	res.status(fallbackStatus).json({ ok: false, error: message });
}

function asRecord(value: unknown): Record<string, unknown> | null {
	return value != null && typeof value === 'object' && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: null;
}

function normalizeRemoteSkillId(value: unknown): string {
	return String(value ?? '').trim();
}

function getApplicationDisplayName(
	item:
		| Partial<LadcraftApplicationListItem>
		| Partial<LadcraftApplicationDetails>
		| null
		| undefined
): string {
	const title = typeof item?.title === 'string' ? item.title.trim() : '';
	if (title) return title;
	const name = typeof item?.name === 'string' ? item.name.trim() : '';
	return name;
}

function buildAuthHeaders(): HeadersInit {
	if (!runtimeSkilledAgentToken) {
		throw new DevServerHttpError(
			401,
			'Ladcraft токен не настроен. Выполните вход через email/password или вставьте token вручную.'
		);
	}
	return {
		Authorization: `Bearer ${runtimeSkilledAgentToken}`
	};
}

async function callLadcraft(pathname: string, init: RequestInit): Promise<Response> {
	const url = `${getRuntimeLadcraftConfig().apiBaseUrl.replace(/\/$/, '')}${pathname}`;
	return fetch(url, init);
}

async function callRemoteWithBase(
	baseUrl: string,
	pathname: string,
	init: RequestInit
): Promise<Response> {
	const url = `${baseUrl.replace(/\/$/, '')}${pathname}`;
	return fetch(url, init);
}

async function tryRefreshLadcraftSession(): Promise<boolean> {
	const env = runtimeLadcraftEnv;
	const refresh = runtimeCredsByEnv[env].refresh.trim();
	if (!refresh) {
		return false;
	}
	const url = `${getRuntimeLadcraftConfig().apiBaseUrl.replace(/\/$/, '')}/v1/auth/refresh`;
	const response = await fetch(url, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ token: refresh })
	});
	const payload = await readRemoteBody(response);
	if (!response.ok) {
		return false;
	}
	const access = extractAccessToken(payload) ?? '';
	const nextRefresh = extractRefreshToken(payload) ?? refresh;
	if (!access) {
		return false;
	}
	setLadcraftCredsForEnv(env, access, nextRefresh);
	persistLadcraftAuthState();
	return true;
}

async function requestLadcraft(
	method: string,
	endpoint: string,
	body?: unknown
): Promise<{ status: number; data: unknown }> {
	const runOnce = async () => {
		const headers = buildAuthHeaders();
		const hasJsonBody = body != null;
		const response = await callLadcraft(endpoint, {
			method,
			headers: hasJsonBody ? { ...headers, 'Content-Type': 'application/json' } : headers,
			body: hasJsonBody ? JSON.stringify(body) : undefined
		});
		const data = await readRemoteBody(response);
		return { response, data };
	};

	let { response, data } = await runOnce();
	if (response.status === 401 || response.status === 403) {
		const refreshed = await tryRefreshLadcraftSession();
		if (refreshed) {
			({ response, data } = await runOnce());
		}
	}
	if (response.status === 401 || response.status === 403) {
		clearLadcraftCredsForEnv(runtimeLadcraftEnv);
		persistLadcraftAuthState();
	}
	return { status: response.status, data };
}

function extractLadcraftApplicationList(payload: unknown): LadcraftApplicationListItem[] {
	const unwrapped = asRecord(unwrapApiEnvelope(payload));
	const applicationsRaw = unwrapped ? (unwrapped.applications as unknown) : undefined;
	const applications = Array.isArray(applicationsRaw) ? applicationsRaw : [];
	const result: LadcraftApplicationListItem[] = [];
	for (const item of applications) {
		const record = asRecord(item);
		if (!record) continue;
		const id = normalizeRemoteSkillId(record.id);
		if (!id) continue;
		const installedRaw = asRecord(record.installed);
		result.push({
			id,
			title: typeof record.title === 'string' ? record.title : undefined,
			name: typeof record.name === 'string' ? record.name : undefined,
			description: typeof record.description === 'string' ? record.description : undefined,
			version: typeof record.version === 'string' ? record.version : undefined,
			installed: installedRaw
				? {
						id: typeof installedRaw.id === 'string' ? installedRaw.id : undefined,
						latest_version:
							typeof installedRaw.latest_version === 'string'
								? installedRaw.latest_version
								: undefined,
						installed_version:
							typeof installedRaw.installed_version === 'string'
								? installedRaw.installed_version
								: undefined
					}
				: null,
			updated_at: typeof record.updated_at === 'string' ? record.updated_at : undefined
		});
	}
	return result;
}

async function listLadcraftAuthoredSkillsDirect(): Promise<LadcraftApplicationListItem[]> {
	const items: LadcraftApplicationListItem[] = [];
	let offset = 0;
	const limit = 100;
	let total = Number.POSITIVE_INFINITY;

	while (offset < total) {
		const remote = await requestLadcraft(
			'GET',
			`/v1/application/list?type=skill&authored_by_me=true&limit=${limit}&offset=${offset}`
		);
		if (remote.status !== 200) {
			throw new DevServerHttpError(
				remote.status,
				extractApiErrorMessage(remote.data, 'Не удалось загрузить навыки из Ladcraft')
			);
		}
		const batch = extractLadcraftApplicationList(remote.data);
		items.push(...batch);
		const unwrapped = asRecord(unwrapApiEnvelope(remote.data));
		const meta = asRecord(unwrapped?.meta);
		total =
			typeof meta?.total === 'number' && Number.isFinite(meta.total) ? meta.total : batch.length;
		if (batch.length === 0 || batch.length < limit) {
			break;
		}
		offset += batch.length;
	}

	return items;
}

async function getLadcraftSkillDetailsDirect(
	applicationId: string
): Promise<LadcraftApplicationDetails> {
	const remote = await requestLadcraft(
		'GET',
		`/v1/application/${encodeURIComponent(applicationId)}?type=skill&return_installed=false`
	);
	if (remote.status !== 200) {
		throw new DevServerHttpError(
			remote.status,
			extractApiErrorMessage(remote.data, 'Не удалось загрузить навык из Ladcraft')
		);
	}
	const unwrapped = asRecord(unwrapApiEnvelope(remote.data));
	if (!unwrapped) {
		throw new DevServerHttpError(502, 'Ladcraft вернул пустые данные навыка');
	}
	return {
		id: normalizeRemoteSkillId(unwrapped.id) || applicationId,
		title: typeof unwrapped.title === 'string' ? unwrapped.title : undefined,
		name: typeof unwrapped.name === 'string' ? unwrapped.name : undefined,
		description: typeof unwrapped.description === 'string' ? unwrapped.description : undefined,
		detailed_description:
			typeof unwrapped.detailed_description === 'string' ? unwrapped.detailed_description : null,
		skill: typeof unwrapped.skill === 'string' ? unwrapped.skill : null,
		version: typeof unwrapped.version === 'string' ? unwrapped.version : null,
		author: typeof unwrapped.author === 'string' ? unwrapped.author : null,
		license: typeof unwrapped.license === 'string' ? unwrapped.license : null,
		tags: Array.isArray(unwrapped.tags) ? unwrapped.tags.map(String) : [],
		category: typeof unwrapped.category === 'string' ? unwrapped.category : null,
		icon: typeof unwrapped.icon === 'string' ? unwrapped.icon : null,
		cover: typeof unwrapped.cover === 'string' ? unwrapped.cover : null,
		tools: Array.isArray(unwrapped.tools)
			? unwrapped.tools.filter((item): item is Record<string, unknown> => asRecord(item) != null)
			: [],
		updated_at: typeof unwrapped.updated_at === 'string' ? unwrapped.updated_at : undefined
	};
}

async function callLadcraftAuthLogin(
	email: string,
	password: string
): Promise<{
	ok: boolean;
	token?: string;
	refreshToken?: string;
	message?: string;
	status: number;
}> {
	const url = `${getRuntimeLadcraftConfig().apiBaseUrl.replace(/\/$/, '')}/v1/auth/login`;
	const response = await fetch(url, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ email, password })
	});
	const payload = await readRemoteBody(response);
	const token = extractAccessToken(payload) ?? '';
	const refreshToken = extractRefreshToken(payload) ?? '';

	if (!response.ok) {
		return {
			ok: false,
			message: extractApiErrorMessage(payload, 'Не удалось авторизоваться в Ladcraft'),
			status: response.status
		};
	}

	if (!token) {
		return {
			ok: false,
			message: 'Ladcraft вернул успешный ответ без access_token',
			status: 502
		};
	}

	return { ok: true, token, refreshToken, status: response.status };
}

async function readRemoteBody(response: Response): Promise<unknown> {
	const text = await response.text();
	if (!text.trim()) return null;
	try {
		return JSON.parse(text);
	} catch {
		return { raw: text };
	}
}

async function ensureSkillsDir(): Promise<void> {
	await mkdir(localSkillsDir, { recursive: true });
}

async function ensurePrototypeSkillsDir(): Promise<void> {
	await mkdir(prototypeSkillsDir, { recursive: true });
}

async function listLocalSkillEntries(): Promise<LocalSkillEntry[]> {
	const entries = await listActiveLocalSkillEntries(localSkillsDir);
	if (entries.length > 0) {
		for (const entry of entries) {
			console.log(`[dev-server] Loaded skill: ${entry.skill.name} from ${entry.fileName}`);
		}
		console.log(`[dev-server] ${localSkillsDir}: ${entries.length} skill folder(s) loaded`);
	}
	return entries;
}

async function findLocalSkillEntry(skillName: string): Promise<LocalSkillEntry | null> {
	return findLocalSkillEntryInStore(localSkillsDir, skillName);
}

async function listPrototypeSkillEntries(): Promise<LocalSkillEntry[]> {
	return listActiveLocalSkillEntries(prototypeSkillsDir);
}

async function findPrototypeSkillEntry(skillName: string): Promise<LocalSkillEntry | null> {
	return findLocalSkillEntryInStore(prototypeSkillsDir, skillName);
}

function buildSkillSummary(entry: LocalSkillEntry): Record<string, unknown> {
	const compatibilityReport = compatibilityAuditManager.getSkillReport(entry.skill.name);
	return {
		name: entry.skill.name,
		description: entry.skill.description,
		scriptsCount: entry.skill.scripts.length,
		widgetsCount: entry.skill.widgets.length,
		updatedAt: entry.updatedAt,
		fileName: entry.fileName,
		filePath: entry.filePath,
		isFromServer: entry.isFromServer ?? false,
		serverSkillId: entry.serverSkillId,
		identityKey: entry.identityKey,
		hasCompatibilityIssues:
			(compatibilityReport?.errorCount ?? 0) + (compatibilityReport?.warningCount ?? 0) > 0,
		compatibilitySummary: compatibilityReport
			? {
					errorCount: compatibilityReport.errorCount,
					warningCount: compatibilityReport.warningCount,
					isBlocking: compatibilityReport.isBlocking,
					summaryText: compatibilityReport.summaryText,
					scannedAt: compatibilityReport.scannedAt
				}
			: null
	};
}

/** Создает скрипт по умолчанию для запуска виджета, если у навыка есть виджеты, но нет скриптов */
function ensureWidgetScript(payload: LocalSkillPayload): void {
	if (payload.widgets.length === 0 || payload.scripts.length > 0) {
		return; // Нет виджетов или уже есть скрипты — ничего не делаем
	}

	// Берем первый виджет и создаем для него скрипт
	const firstWidget = payload.widgets[0];
	const widgetNameRaw =
		typeof firstWidget.name === 'string' && firstWidget.name.trim()
			? firstWidget.name.trim()
			: 'widget';
	const widgetName = widgetNameRaw; // Используем как есть для returnResultInWidget
	const widgetSchema = (
		firstWidget.schema && typeof firstWidget.schema === 'object' ? firstWidget.schema : {}
	) as {
		type?: string;
		properties?: Record<string, unknown>;
		required?: string[];
	};

	// Имя скрипта: нормализуем имя виджета и создаем launch{WidgetName} или launchWidget
	const normalizedWidgetName =
		widgetNameRaw
			.replace(/[^a-zA-Z0-9_]/g, '') // Убираем спецсимволы
			.replace(/^[0-9]/, '') || // Убираем начальные цифры
		'widget';
	const scriptName =
		normalizedWidgetName !== 'widget'
			? `launch${normalizedWidgetName.charAt(0).toUpperCase() + normalizedWidgetName.slice(1)}`
			: 'launchWidget';

	// Создаем input_schema на основе schema виджета
	const inputSchema: Record<string, unknown> = {
		type: 'object',
		properties: widgetSchema.properties || {},
		required: widgetSchema.required || []
	};

	// Код скрипта: просто передает входные данные в виджет
	const scriptCode = `// Автоматически созданный скрипт для запуска виджета "${widgetName}"
// Передает входные параметры в виджет для отображения

async function handler(state, params) {
  /*__CURSOR_LADCRAFT_WIDGET_NAME__=${widgetName}*/
  return params;
}
`;

	const widgetScript: LocalSkillScript = {
		name: scriptName,
		description: `Запускает виджет "${widgetName}" с переданными параметрами`,
		input_schema: inputSchema,
		output_schema: null,
		script_file: null,
		code: scriptCode,
		auth: null
	};

	payload.scripts.push(widgetScript);
	console.log(
		`[dev-server] Автоматически создан скрипт "${scriptName}" для виджета "${widgetName}" (у навыка были виджеты, но не было скриптов)`
	);
}

function getScriptFromSkill(skill: LocalSkillPayload, scriptName: string): LocalSkillScript {
	const found = skill.scripts.find((script) => script.name === scriptName);
	if (!found) {
		throw new Error(`Script \"${scriptName}\" not found in local skill \"${skill.name}\"`);
	}
	if (!found.code || !found.code.trim()) {
		throw new Error(`Script \"${scriptName}\" has empty code`);
	}
	return found;
}

function escapeHtml(value: unknown): string {
	return String(value ?? '')
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&#39;');
}

function hasEjsSyntax(template: string): boolean {
	return /<%[=-]?[\s\S]*?%>/.test(template);
}

function hasHandlebarsBlockSyntax(template: string): boolean {
	return /{{\s*(?:[#/^]|else\b)/.test(template);
}

function renderEjsTemplate(template: string, data: unknown): string {
	const record = data && typeof data === 'object' && !Array.isArray(data)
		? (data as Record<string, unknown>)
		: {};
	const locals = {
		...record,
		result: record,
		data: record
	};
	const parts: string[] = [];
	let cursor = 0;
	const matcher = /<%([=-]?)([\s\S]*?)%>/g;
	let match: RegExpExecArray | null;
	while ((match = matcher.exec(template))) {
		const rawText = template.slice(cursor, match.index);
		if (rawText) parts.push(`__out += ${JSON.stringify(rawText)};`);
		const marker = match[1] ?? '';
		const code = match[2] ?? '';
		if (marker === '=') {
			parts.push(`__out += __escape((${code}));`);
		} else if (marker === '-') {
			parts.push(`__out += ((${code}) ?? "");`);
		} else {
			parts.push(code);
		}
		cursor = match.index + match[0].length;
	}
	const tail = template.slice(cursor);
	if (tail) parts.push(`__out += ${JSON.stringify(tail)};`);
	const source = [
		'let __out = "";',
		'const print = (...args) => { __out += args.join(""); };',
		'with (locals || {}) {',
		...parts,
		'}',
		'return __out;'
	].join('\n');
	const render = new Function('locals', '__escape', source) as (
		locals: Record<string, unknown>,
		escape: (value: unknown) => string
	) => string;
	return render(locals, escapeHtml);
}

function renderWidgetTemplate(templateSource: string, data: unknown): string {
	if (hasEjsSyntax(templateSource)) {
		try {
			return renderEjsTemplate(templateSource, data);
		} catch (err) {
			console.warn(
				'[dev-server] EJS widget render failed, falling back to Handlebars:',
				err instanceof Error ? err.message : String(err)
			);
		}
	}
	const template = Handlebars.compile(templateSource);
	return template((data as Record<string, unknown>) || {});
}

function renderLocalWidgetHtml(
	skill: LocalSkillPayload,
	widgetName: string,
	data: unknown
): string | null {
	const widget = skill.widgets.find((item) => {
		const widgetNameValue = (item as { name?: unknown }).name;
		return typeof widgetNameValue === 'string' && widgetNameValue === widgetName;
	}) as
		| {
				name: string;
				template?: unknown;
				external_libraries?: unknown;
				scripts?: unknown;
		  }
		| undefined;

	if (!widget || typeof widget.template !== 'string') {
		return null;
	}

	const contentHtml = renderWidgetTemplate(widget.template, data);

	const externalLibraries = Array.isArray(widget.external_libraries)
		? widget.external_libraries
		: [];
	const widgetScripts = Array.isArray(widget.scripts) ? widget.scripts : [];

	const cssLinks = externalLibraries
		.filter((lib) => lib && typeof lib === 'object' && (lib as { type?: unknown }).type === 'css')
		.map((lib) => {
			const url = String((lib as { url?: unknown }).url || '').trim();
			return url ? `<link rel="stylesheet" href="${url}" />` : '';
		})
		.join('\n');

	const externalJs = externalLibraries
		.filter((lib) => lib && typeof lib === 'object' && (lib as { type?: unknown }).type === 'js')
		.map((lib) => {
			const url = String((lib as { url?: unknown }).url || '').trim();
			return url ? `<script src="${url}" defer></script>` : '';
		})
		.join('\n');

	const scriptsHtml = widgetScripts
		.map((script) => {
			if (!script || typeof script !== 'object') return '';
			const scriptType = (script as { type?: unknown }).type;
			if (scriptType === 'inline') {
				const content = String((script as { content?: unknown }).content || '');
				return content ? `<script>${content}</script>` : '';
			}
			if (scriptType === 'url') {
				const url = String((script as { url?: unknown }).url || '').trim();
				return url ? `<script src="${url}" defer></script>` : '';
			}
			return '';
		})
		.join('\n');

	return `<!doctype html>
<html>
	<head>
		<meta charset="utf-8" />
		<meta name="viewport" content="width=device-width, initial-scale=1" />
		${cssLinks}
		${externalJs}
		<style>
			html, body {
				margin: 0;
				padding: 0;
				background: #f8fbff;
			}
			body {
				padding: 12px;
			}
		</style>
	</head>
	<body>
		${contentHtml}
		${scriptsHtml}
	</body>
</html>`;
}

function buildPrototypeAuthHeaders(): HeadersInit {
	if (!prototypeRuntimeToken) {
		throw new DevServerHttpError(
			400,
			config.prototypeTokenWarning ||
				'Токен prototype API не настроен. Укажите PROTOTYPE_SKILLED_AGENT_TOKEN или token в .cursor/mcp.json.'
		);
	}
	return {
		Authorization: `Bearer ${prototypeRuntimeToken}`
	};
}

async function requestPrototypeRemote(
	method: string,
	endpoint: string,
	body?: unknown
): Promise<{ status: number; data: unknown }> {
	const headers = buildPrototypeAuthHeaders();
	const hasJsonBody = body != null;
	const response = await callRemoteWithBase(config.prototypeSkilledAgentUrl, endpoint, {
		method,
		headers: hasJsonBody ? { ...headers, 'Content-Type': 'application/json' } : headers,
		body: hasJsonBody ? JSON.stringify(body) : undefined
	});
	const data = await readRemoteBody(response);
	return { status: response.status, data };
}

function resolveUniqueLocalSkillName(baseName: string, existingNames: Set<string>): string {
	if (!existingNames.has(baseName)) return baseName;
	let suffix = 1;
	while (true) {
		const next = `${baseName}_prototype_${suffix}`;
		if (!existingNames.has(next)) return next;
		suffix += 1;
	}
}

function readLocalCursorLadcraftBundleVersion(): string | null {
	if (!existsSync(cursorLadcraftVersionFile)) {
		return null;
	}
	try {
		const version = readFileSync(cursorLadcraftVersionFile, 'utf-8').trim();
		return version || null;
	} catch {
		return null;
	}
}

async function readRemoteCursorLadcraftBundleVersion(): Promise<{
	version: string | null;
	error: string | null;
}> {
	if (!prototypeRuntimeToken) {
		return { version: null, error: null };
	}
	try {
		const remote = await requestPrototypeRemote('GET', '/api/skills-builder-ladcraft/bundle-version');
		if (remote.status !== 200) {
			return {
				version: null,
				error: extractApiErrorMessage(remote.data, 'Не удалось получить версию cursor_ladcraft')
			};
		}
		const unwrapped = asRecord(unwrapApiEnvelope(remote.data));
		const version = typeof unwrapped?.version === 'string' ? unwrapped.version.trim() : '';
		return {
			version: version || null,
			error: version ? null : 'В ответе не найдено поле version'
		};
	} catch (err) {
		return {
			version: null,
			error: err instanceof Error ? err.message : 'Не удалось получить версию cursor_ladcraft'
		};
	}
}

app.get('/api/events', (req, res) => {
	res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
	res.setHeader('Cache-Control', 'no-cache, no-transform');
	res.setHeader('Connection', 'keep-alive');
	res.setHeader('X-Accel-Buffering', 'no');
	if (typeof res.flushHeaders === 'function') {
		res.flushHeaders();
	}
	writeSseChunk(res, 'connected', '{}');
	sseClients.add(res);
	const heartbeat = setInterval(() => {
		try {
			res.write(': heartbeat\n\n');
		} catch {
			clearInterval(heartbeat);
			sseClients.delete(res);
		}
	}, SSE_HEARTBEAT_MS);
	let cleaned = false;
	const cleanup = (): void => {
		if (cleaned) return;
		cleaned = true;
		clearInterval(heartbeat);
		sseClients.delete(res);
		try {
			res.end();
		} catch {
			/* ignore */
		}
	};
	req.on('close', cleanup);
});

app.get('/api/health', async (_req, res) => {
	const authStatuses = getAuthStatusesByEnv();
	const localBundleVersion = readLocalCursorLadcraftBundleVersion();
	const remoteBundle = await readRemoteCursorLadcraftBundleVersion();
	const bundleUpdateStatus = await bundleUpdateManager.getStatus();
	const bundleOutdated = Boolean(
		localBundleVersion &&
			remoteBundle.version &&
			localBundleVersion.trim() !== remoteBundle.version.trim()
	);
	res.json({
		ok: true,
		devServerPort: config.devServerPort,
		webUiPort: config.webUiPort,
		hasSkilledAgentToken: Boolean(runtimeSkilledAgentToken),
		hasPrototypeToken: Boolean(prototypeRuntimeToken),
		ladcraftEnv: runtimeLadcraftEnv,
		ladcraftApiBaseUrl: getRuntimeLadcraftConfig().apiBaseUrl,
		ladcraftReauthUrl: getRuntimeLadcraftConfig().reauthUrl,
		authStatuses,
		ladcraftTokenRefreshHint: config.ladcraftTokenRefreshHint,
		prototypeSkilledAgentUrl: config.prototypeSkilledAgentUrl,
		prototypeSkilledAgentUrlSource: config.prototypeSkilledAgentUrlSource,
		prototypeSkilledAgentTokenSource: config.prototypeSkilledAgentTokenSource,
		prototypeTokenWarning: config.prototypeTokenWarning,
		mcpUrl: config.mcpUrl,
		localSkillsDir,
		prototypeSkillsDir,
		cursorLadcraftBundleVersion: localBundleVersion,
		remoteCursorLadcraftBundleVersion: remoteBundle.version,
		cursorLadcraftBundleOutdated: bundleOutdated,
		cursorLadcraftBundleVersionError: remoteBundle.error,
		bundleUpdateStatus
	});
});

app.get('/api/system/download-config', async (_req, res) => {
	try {
		const response = await callRemoteWithBase(
			config.prototypeSkilledAgentUrl,
			'/api/skills-builder-ladcraft/download-config',
			{
				method: 'GET',
				headers: buildPrototypeAuthHeaders()
			}
		);
		if (!response.ok) {
			const payload = await readRemoteBody(response);
			res.status(response.status).json({
				ok: false,
				error: extractApiErrorMessage(payload, 'Не удалось скачать cursor_ladcraft')
			});
			return;
		}
		const archiveBuffer = Buffer.from(await response.arrayBuffer());
		const contentType = response.headers.get('content-type') || 'application/zip';
		const contentDisposition =
			response.headers.get('content-disposition') ||
			'attachment; filename="cursor_ladcraft.zip"';
		res.setHeader('Content-Type', contentType);
		res.setHeader('Content-Disposition', contentDisposition);
		res.setHeader('Content-Length', String(archiveBuffer.length));
		res.send(archiveBuffer);
	} catch (err) {
		sendHttpError(res, err, 'Не удалось скачать cursor_ladcraft', 502);
	}
});

app.get('/api/system/update/status', async (_req, res) => {
	try {
		const status = await bundleUpdateManager.getStatus();
		res.json({ ok: true, status });
	} catch (err) {
		sendHttpError(res, err, 'Не удалось получить статус обновления', 500);
	}
});

app.post('/api/system/update/start', async (_req, res) => {
	try {
		if (!prototypeRuntimeToken.trim()) {
			throw new DevServerHttpError(
				400,
				config.prototypeTokenWarning ||
					'Токен prototype API не настроен. Автообновление недоступно.'
			);
		}
		const localBundleVersion = readLocalCursorLadcraftBundleVersion();
		const remoteBundle = await readRemoteCursorLadcraftBundleVersion();
		if (!remoteBundle.version) {
			throw new DevServerHttpError(
				400,
				remoteBundle.error || 'Не удалось получить удаленную версию cursor_ladcraft'
			);
		}
		const status = await bundleUpdateManager.startUpdate({
			currentVersion: localBundleVersion,
			targetVersion: remoteBundle.version,
			prototypeBaseUrl: config.prototypeSkilledAgentUrl,
			prototypeToken: prototypeRuntimeToken,
			serverPid: process.pid
		});
		res.json({ ok: true, status });
	} catch (err) {
		sendHttpError(res, err, 'Не удалось запустить автообновление', 400);
	}
});

app.post('/api/system/update/rollback', async (_req, res) => {
	try {
		const status = await bundleUpdateManager.startRollback({ serverPid: process.pid });
		res.json({ ok: true, status });
	} catch (err) {
		sendHttpError(res, err, 'Не удалось запустить rollback обновления', 400);
	}
});

app.post('/api/auth/login', async (req, res) => {
	try {
		const parsed = authLoginSchema.parse(req.body);
		const loginResult = await callLadcraftAuthLogin(parsed.email.trim(), parsed.password);
		if (!loginResult.ok || !loginResult.token) {
			res.status(loginResult.status).json({
				ok: false,
				error: loginResult.message ?? 'Не удалось авторизоваться в Ladcraft'
			});
			return;
		}

		setLadcraftCredsForEnv(runtimeLadcraftEnv, loginResult.token, loginResult.refreshToken ?? '');
		persistLadcraftAuthState();
		res.json({ ok: true, ladcraftEnv: runtimeLadcraftEnv, authStatuses: getAuthStatusesByEnv() });
	} catch (err) {
		sendHttpError(res, err, 'Failed to login to Ladcraft', 400);
	}
});

app.post('/api/auth/token', async (req, res) => {
	try {
		const parsed = setAuthTokenSchema.parse(req.body);
		setLadcraftCredsForEnv(runtimeLadcraftEnv, parsed.token, '');
		persistLadcraftAuthState();
		res.json({ ok: true, ladcraftEnv: runtimeLadcraftEnv, authStatuses: getAuthStatusesByEnv() });
	} catch (err) {
		res.status(400).json({
			ok: false,
			error: err instanceof Error ? err.message : 'Failed to update token'
		});
	}
});

app.post('/api/auth/environment', async (req, res) => {
	try {
		const parsed = setLadcraftEnvironmentSchema.parse(req.body);
		runtimeLadcraftEnv = parsed.environment;
		syncRuntimeTokenFromActiveEnv();
		persistLadcraftAuthState();
		res.json({
			ok: true,
			ladcraftEnv: runtimeLadcraftEnv,
			hasSkilledAgentToken: Boolean(runtimeSkilledAgentToken),
			authStatuses: getAuthStatusesByEnv(),
			ladcraftApiBaseUrl: getRuntimeLadcraftConfig().apiBaseUrl,
			ladcraftReauthUrl: getRuntimeLadcraftConfig().reauthUrl
		});
	} catch (err) {
		res.status(400).json({
			ok: false,
			error: err instanceof Error ? err.message : 'Failed to switch Ladcraft environment'
		});
	}
});

app.post('/api/auth/logout', async (req, res) => {
	try {
		const parsed = setLadcraftEnvironmentSchema.parse(req.body);
		clearLadcraftCredsForEnv(parsed.environment);
		persistLadcraftAuthState();
		res.json({
			ok: true,
			ladcraftEnv: runtimeLadcraftEnv,
			hasSkilledAgentToken: Boolean(runtimeSkilledAgentToken),
			authStatuses: getAuthStatusesByEnv(),
			loggedOutEnvironment: parsed.environment
		});
	} catch (err) {
		res.status(400).json({
			ok: false,
			error: err instanceof Error ? err.message : 'Failed to logout from Ladcraft'
		});
	}
});

app.get('/api/local/skills', async (_req, res) => {
	try {
		const auditReport = await compatibilityAuditManager.ensureFresh();
		const entries = await listLocalSkillEntries();
		console.log(`[dev-server] GET /api/local/skills -> ${entries.length} skills`);
		res.json({
			ok: true,
			skills: entries.map(buildSkillSummary),
			compatibilityAudit: buildCompatibilityAuditMeta({
				report: auditReport,
				isRunning: compatibilityAuditManager.isRunning()
			})
		});
	} catch (err) {
		const msg = err instanceof Error ? err.message : 'Failed to read local skills';
		console.error('[dev-server] GET /api/local/skills error:', msg);
		res.status(500).json({ ok: false, error: msg });
	}
});

app.get('/api/local/skills/:skillName', async (req, res) => {
	try {
		const auditReport = await compatibilityAuditManager.ensureFresh();
		const entry = await findLocalSkillEntry(req.params.skillName);
		if (!entry) {
			console.log(`[dev-server] GET /api/local/skills/${req.params.skillName} -> 404`);
			res
				.status(404)
				.json({ ok: false, error: `Local skill \"${req.params.skillName}\" not found` });
			return;
		}
		res.json({
			ok: true,
			skill: entry.skill,
			meta: buildSkillSummary(entry),
			compatibilityAudit: buildCompatibilityAuditMeta({
				report: auditReport,
				isRunning: compatibilityAuditManager.isRunning()
			}),
			compatibilityReport: compatibilityAuditManager.getSkillReport(entry.skill.name)
		});
	} catch (err) {
		const msg = err instanceof Error ? err.message : 'Failed to read local skill';
		console.error(`[dev-server] GET /api/local/skills/${req.params.skillName} error:`, msg);
		res.status(500).json({ ok: false, error: msg });
	}
});

app.get('/api/local/skills/:skillName/compatibility', async (req, res) => {
	try {
		const auditReport = await compatibilityAuditManager.ensureFresh();
		const entry = await findLocalSkillEntry(req.params.skillName);
		const report: SkillCompatibilityReport | null =
			entry != null ? compatibilityAuditManager.getSkillReport(entry.skill.name) : null;
		res.json({
			ok: true,
			report,
			compatibilityAudit: buildCompatibilityAuditMeta({
				report: auditReport,
				isRunning: compatibilityAuditManager.isRunning()
			})
		});
	} catch (err) {
		const msg = err instanceof Error ? err.message : 'Failed to read compatibility report';
		res.status(500).json({ ok: false, error: msg });
	}
});

app.get('/api/local/skills/:skillName/installation-form-draft', async (req, res) => {
	try {
		const draft = await readInstallationFormDraft(req.params.skillName);
		res.json({ ok: true, installationForm: draft });
	} catch (err) {
		sendHttpError(res, err, 'Failed to read installation form draft');
	}
});

app.post('/api/local/skills/:skillName/installation-form-draft', async (req, res) => {
	try {
		const parsed = installationFormDraftSchema.parse(req.body);
		await saveInstallationFormDraft(req.params.skillName, parsed.installationForm);
		res.json({ ok: true });
	} catch (err) {
		sendHttpError(res, err, 'Failed to save installation form draft', 400);
	}
});

app.get('/api/prototype/skills', async (_req, res) => {
	try {
		const entries = await listPrototypeSkillEntries();
		res.json({
			ok: true,
			skills: entries.map(buildSkillSummary)
		});
	} catch (err) {
		const msg = err instanceof Error ? err.message : 'Failed to read prototype skills';
		res.status(500).json({ ok: false, error: msg });
	}
});

app.get('/api/prototype/skills/:skillName', async (req, res) => {
	try {
		const entry = await findPrototypeSkillEntry(req.params.skillName);
		if (!entry) {
			res
				.status(404)
				.json({ ok: false, error: `Prototype skill \"${req.params.skillName}\" not found` });
			return;
		}
		res.json({
			ok: true,
			skill: entry.skill,
			meta: buildSkillSummary(entry)
		});
	} catch (err) {
		const msg = err instanceof Error ? err.message : 'Failed to read prototype skill';
		res.status(500).json({ ok: false, error: msg });
	}
});

app.post('/api/prototype/skills/sync', async (_req, res) => {
	try {
		const remote = await requestPrototypeRemote('GET', '/api/skills/user');
		if (remote.status !== 200) {
			res.status(remote.status).json({
				ok: false,
				error: extractApiErrorMessage(remote.data, 'Не удалось загрузить навыки прототипа')
			});
			return;
		}
		const result: Array<{
			id: string;
			name: string;
			isNew: boolean;
			hasConflict: boolean;
			identityKey: string;
		}> = [];
		const remoteSkills = extractSkillsArray(remote.data);
		if (remoteSkills.length === 0) {
			res.status(200).json({ skills: result });
			return;
		}
		await ensurePrototypeSkillsDir();
		await mkdir(prototypeCacheDir, { recursive: true });
		for (const remoteSkill of remoteSkills) {
			try {
				const skillId = normalizeRemoteSkillId(remoteSkill.id);
				const skillName = typeof remoteSkill.name === 'string' ? remoteSkill.name : '';
				if (!skillName) continue;
				const localPayload = convertRemoteSkillToLocal(remoteSkill as RemoteSkillRecord);
				const existingEntryBeforeSync = await findLocalSkillEntryInStore(
					prototypeSkillsDir,
					skillName,
					skillId
				);
				const cachePath = getRemoteCacheFolderPath(prototypeCacheDir, skillName);
				if (existsSync(cachePath)) {
					await rm(cachePath, { recursive: true });
				}
				await writeSkillToFolder(cachePath, localPayload);
				await migrateLegacySkillFolder({
					localSkillsDir: prototypeSkillsDir,
					quarantineDir: prototypeLegacyConflictDir,
					skillName
				});
				let mainEntry = await findLocalSkillEntryInStore(prototypeSkillsDir, skillName, skillId);
				const mainPath =
					mainEntry?.filePath ?? getCanonicalSkillFolderPath(prototypeSkillsDir, skillName);
				const existsLocally = !!mainEntry;
				let hasConflict = false;
				if (existsLocally) {
					try {
						const localPayloadFromFolder = await convertFolderToPayloadJson(mainPath);
						hasConflict = !payloadsEqual(localPayloadFromFolder, localPayload);
					} catch {
						hasConflict = true;
					}
				} else if (!hasExistingSkillFolder(prototypeSkillsDir, skillName)) {
					await writeSkillToFolder(mainPath, localPayload);
				} else {
					// Keep files untouched when folder exists but parsing failed.
					hasConflict = true;
				}
				if (skillId) {
					const metaPath = path.join(mainPath, '.from-server.json');
					await writeFile(
						metaPath,
						JSON.stringify({ skillId, syncedAt: new Date().toISOString() }, null, 2),
						'utf-8'
					);
				}
				mainEntry = await findLocalSkillEntryInStore(prototypeSkillsDir, skillName, skillId);
				result.push({
					id: skillId,
					name: skillName,
					isNew: !existingEntryBeforeSync,
					hasConflict,
					identityKey:
						mainEntry?.identityKey ??
						getSkillIdentityKey({ name: skillName, serverSkillId: skillId || null })
				});
			} catch (err) {
				console.error('[dev-server] Error processing prototype skill:', err);
			}
		}
		const remoteIds = new Set(result.map((r) => r.id).filter((id) => id.length > 0));
		const remoteNames = new Set(result.map((r) => r.name));
		const localEntries = await listActiveLocalSkillEntries(prototypeSkillsDir);
		for (const entry of localEntries) {
			const metaPath = path.join(entry.filePath, '.from-server.json');
			const stillOnServer =
				typeof entry.serverSkillId === 'string' && entry.serverSkillId.length > 0
					? remoteIds.has(entry.serverSkillId)
					: remoteNames.has(entry.skill.name);
			if (entry.isFromServer && existsSync(metaPath) && !stillOnServer) {
				await unlink(metaPath);
			}
		}
		broadcastSseEvent('prototype-skills-changed');
		res.status(200).json({ ok: true, skills: result });
	} catch (err) {
		sendHttpError(res, err, 'Failed to sync prototype skills');
	}
});

app.post('/api/prototype/skills/copy-to-local', async (req, res) => {
	try {
		const parsed = prototypeCopyToLocalSchema.parse(req.body);
		const sourceEntry = await findPrototypeSkillEntry(parsed.skillName);
		if (!sourceEntry) {
			res
				.status(404)
				.json({ ok: false, error: `Prototype skill \"${parsed.skillName}\" not found` });
			return;
		}
		await ensureSkillsDir();
		const existingLocalEntries = await listLocalSkillEntries();
		const existingNames = new Set(existingLocalEntries.map((entry) => entry.skill.name));
		const requestedName = parsed.targetName?.trim() || sourceEntry.skill.name;
		const copyName = parsed.overwrite
			? requestedName
			: resolveUniqueLocalSkillName(requestedName, existingNames);
		const payloadToCopy: LocalSkillPayload = {
			...sourceEntry.skill,
			name: copyName
		};
		await migrateLegacySkillFolder({
			localSkillsDir,
			quarantineDir: legacyConflictDir,
			skillName: copyName
		});
		const targetPath = getCanonicalSkillFolderPath(localSkillsDir, copyName);
		if (parsed.overwrite) {
			const existing = await findLocalSkillEntryInStore(localSkillsDir, copyName);
			if (existing && existing.filePath !== targetPath) {
				await rm(existing.filePath, { recursive: true, force: true });
			}
		}
		await writeSkillToFolder(targetPath, payloadToCopy);
		await unlink(path.join(targetPath, '.from-server.json')).catch(() => {});
		compatibilityAuditManager.schedule();
		broadcastSseEvent('local-skills-changed');
		res.status(200).json({
			ok: true,
			sourceSkillName: sourceEntry.skill.name,
			copiedSkillName: copyName,
			overwritten: parsed.overwrite === true
		});
	} catch (err) {
		const msg = err instanceof Error ? err.message : 'Failed to copy prototype skill';
		res.status(400).json({ ok: false, error: msg });
	}
});

// Chain state: храним шаги цепочки выполнения скриптов (не отправляется на сервер)
app.get('/api/local/chain-state', async (req, res) => {
	try {
		const skillName = typeof req.query.skillName === 'string' ? req.query.skillName : '';
		if (!skillName.trim()) {
			res.status(400).json({ ok: false, error: 'skillName required' });
			return;
		}
		await mkdir(chainStateDir, { recursive: true });
		const canonicalPath = path.join(chainStateDir, getCanonicalChainStateFileName(skillName));
		const legacyPath = path.join(chainStateDir, getLegacyChainStateFileName(skillName));
		let filePath = canonicalPath;
		if (!existsSync(filePath) && existsSync(legacyPath) && legacyPath !== canonicalPath) {
			const legacyRaw = await readFile(legacyPath, 'utf-8');
			await writeFile(canonicalPath, legacyRaw, 'utf-8');
			await unlink(legacyPath).catch(() => {});
			filePath = canonicalPath;
		}
		if (!existsSync(filePath)) {
			res.json({ ok: true, steps: [] });
			return;
		}
		const raw = await readFile(filePath, 'utf-8');
		const data = JSON.parse(raw) as {
			steps?: Array<{ scriptName: string; input: unknown; output: unknown }>;
		};
		res.json({ ok: true, steps: Array.isArray(data.steps) ? data.steps : [] });
	} catch (err) {
		const msg = err instanceof Error ? err.message : 'Failed to read chain state';
		console.error('[dev-server] GET /api/local/chain-state error:', msg);
		res.status(500).json({ ok: false, error: msg });
	}
});

const chainStateSchema = z.object({
	skillName: z.string().min(1),
	steps: z.array(
		z.object({
			scriptName: z.string(),
			input: z.unknown(),
			output: z.unknown()
		})
	)
});

app.post('/api/local/chain-state', async (req, res) => {
	try {
		const parsed = chainStateSchema.parse(req.body);
		await mkdir(chainStateDir, { recursive: true });
		const filePath = path.join(chainStateDir, getCanonicalChainStateFileName(parsed.skillName));
		const legacyPath = path.join(chainStateDir, getLegacyChainStateFileName(parsed.skillName));
		await writeFile(filePath, JSON.stringify({ steps: parsed.steps }, null, 2), 'utf-8');
		if (legacyPath !== filePath) {
			await unlink(legacyPath).catch(() => {});
		}
		res.json({ ok: true, steps: parsed.steps });
	} catch (err) {
		const msg = err instanceof Error ? err.message : 'Failed to save chain state';
		console.error('[dev-server] POST /api/local/chain-state error:', msg);
		res.status(400).json({ ok: false, error: msg });
	}
});

app.delete('/api/local/skills/:skillName', async (req, res) => {
	try {
		const entry = await findLocalSkillEntry(req.params.skillName);
		if (!entry) {
			res
				.status(404)
				.json({ ok: false, error: `Local skill \"${req.params.skillName}\" not found` });
			return;
		}
		await rm(entry.filePath, { force: true, recursive: true });
		console.log(
			`[dev-server] DELETE /api/local/skills/${req.params.skillName} -> removed folder ${entry.filePath}`
		);
		compatibilityAuditManager.schedule();
		broadcastSseEvent('local-skills-changed');
		res.json({ ok: true, deleted: entry.fileName });
	} catch (err) {
		const msg = err instanceof Error ? err.message : 'Failed to delete local skill';
		console.error(`[dev-server] DELETE /api/local/skills/${req.params.skillName} error:`, msg);
		res.status(500).json({ ok: false, error: msg });
	}
});

app.post('/api/local/skills/upsert', async (req, res) => {
	try {
		const parsed = localUpsertSchema.parse(req.body);
		const rawPayload: LocalSkillPayload = {
			...parsed.skillPayload,
			scripts: parsed.skillPayload.scripts ?? [],
			widgets: parsed.skillPayload.widgets ?? [],
			mcp_spec: parsed.skillPayload.mcp_spec ?? null
		};
		const { payload } = normalizeLocalSkillPayloadForStorage(rawPayload);

		await ensureSkillsDir();
		await migrateLegacySkillFolder({
			localSkillsDir,
			quarantineDir: legacyConflictDir,
			skillName: payload.name
		});
		const folderPath = getCanonicalSkillFolderPath(localSkillsDir, payload.name);
		const folderName = path.basename(folderPath);

		if (parsed.previousName && parsed.previousName !== payload.name) {
			const previousEntry = await findLocalSkillEntry(parsed.previousName);
			if (previousEntry && previousEntry.filePath !== folderPath) {
				if (!existsSync(folderPath)) {
					await rename(previousEntry.filePath, folderPath);
				} else {
					await rm(previousEntry.filePath, { force: true, recursive: true });
				}
			}
		}

		await writeSkillToFolder(folderPath, payload);
		compatibilityAuditManager.schedule();
		broadcastSseEvent('local-skills-changed');

		res.json({
			ok: true,
			fileName: folderName,
			skill: payload
		});
	} catch (err) {
		res.status(400).json({
			ok: false,
			error: err instanceof Error ? err.message : 'Failed to save local skill'
		});
	}
});

app.post('/api/local/execute', async (req, res) => {
	try {
		const parsed = localExecuteSchema.parse(req.body);
		let code = parsed.code?.trim();
		const skillName = (parsed.skillName || 'local-skill').trim();
		const scriptName = (parsed.scriptName || 'localScript').trim();
		let entry: LocalSkillEntry | null =
			parsed.skillName && parsed.skillName.trim() ? await findLocalSkillEntry(parsed.skillName) : null;
		let scriptForWidget: LocalSkillScript | null = null;

		if (!code) {
			if (!parsed.skillName || !parsed.scriptName) {
				throw new Error('Either code or skillName + scriptName must be provided');
			}
			if (!entry) {
				throw new Error(`Local skill \"${parsed.skillName}\" not found`);
			}
			scriptForWidget = getScriptFromSkill(entry.skill, parsed.scriptName);
			code = scriptForWidget.code;
		} else if (entry && parsed.scriptName) {
			scriptForWidget = getScriptFromSkill(entry.skill, parsed.scriptName);
		}

		const effectiveSkillName = entry?.skill.name || skillName;
		const effectiveScriptName = scriptForWidget?.name || scriptName;
		const skillStorage = skillStorageManager.forSkill(effectiveSkillName);
		const installationDraft =
			entry != null ? await readInstallationFormDraft(entry.skill.name) : {};
		const userEnvironment = resolveUserEnvironmentForScript(installationDraft, effectiveScriptName);
		const skillScriptsDir =
			entry != null ? path.join(entry.filePath, 'scripts') : null;
		const execution = await executeLocalScript({
			code,
			input: parsed.input ?? {},
			skillName: effectiveSkillName,
			scriptName: effectiveScriptName,
			env: process.env,
			skillStorage,
			vfs,
			oauthToken: parsed.mocks?.oauthToken || null,
			telegramChatId: parsed.mocks?.telegramChatId || null,
			skillScriptsDir,
			userEnvironment
		});

		let widget: {
			name: string;
			html: string;
		} | null = null;
		if (entry && scriptForWidget) {
			const resolvedWidget = resolveWidgetForScript(entry.skill, scriptForWidget);
			if (resolvedWidget.widgetName) {
				const html = renderLocalWidgetHtml(entry.skill, resolvedWidget.widgetName, execution.result);
				if (html) {
					widget = { name: resolvedWidget.widgetName, html };
				}
			}
		}

		res.json({ ok: true, ...execution, widget });
	} catch (err) {
		res
			.status(400)
			.json({ ok: false, error: err instanceof Error ? err.message : 'Local execution failed' });
	}
});

/** Конвертирует skill payload прототипа в локальный folder-format payload. */
function convertRemoteSkillToLocal(remoteSkill: RemoteSkillRecord): LocalSkillPayload {
	const directMcpSpec = asRecord(remoteSkill.mcp_spec) ?? asRecord(remoteSkill.mcpSpec) ?? null;
	const fallbackTools = Array.isArray(remoteSkill.tools) ? remoteSkill.tools : [];
	const fallbackDefaultCapabilitiesRequired = extractDefaultCapabilitiesRequiredFromTools(
		fallbackTools
	);
	const mcpSpecFromTools =
		directMcpSpec ??
		(fallbackTools.length > 0
			? ({
					tools: fallbackTools.map((tool) => ({
						...tool,
						environment: asRecord((tool as Record<string, unknown>)?.environment) ?? undefined
					})),
					...(fallbackDefaultCapabilitiesRequired.length > 0
						? {
								default_capabilities: {
									required: fallbackDefaultCapabilitiesRequired
								}
							}
						: {})
				} as Record<string, unknown>)
			: null);

	return {
		name: remoteSkill.name,
		description: remoteSkill.description,
		body: remoteSkill.body,
		scripts: remoteSkill.scripts.map((s) => ({
			name: s.name,
			description: s.description,
			input_schema: s.input_schema,
			output_schema: s.output_schema,
			script_file: s.script_file,
			code: s.code,
			auth: s.auth
		})),
		widgets: remoteSkill.widgets.map((w) => ({
			name: w.name,
			description: w.description,
			schema: w.schema,
			template: w.template,
			scripts: w.scripts,
			external_libraries: w.external_libraries
		})),
		mcp_spec: mcpSpecFromTools
	};
}

function extractDefaultCapabilitiesRequiredFromTools(
	tools: Array<Record<string, unknown>>
): LadcraftCapabilityRequirement[] {
	const out = new Map<string, LadcraftCapabilityRequirement>();
	for (const tool of tools) {
		const capabilities = asRecord(tool.capabilities);
		const requiredRaw = capabilities?.required;
		if (!Array.isArray(requiredRaw)) continue;
		for (const raw of requiredRaw) {
			const cap = parseRawCapabilityRequirement(raw);
			if (!cap) continue;
			const normalized = normalizeCapabilityRequirementForRuntime(cap);
			const key = `${normalized.type}:${normalized.scope}`;
			const prev = out.get(key);
			if (!prev) {
				out.set(key, normalized);
				continue;
			}
			const mergedOps = Array.from(new Set([...prev.operations, ...normalized.operations]));
			out.set(key, { ...prev, operations: mergedOps });
		}
	}
	return [...out.values()];
}

const EMBEDDED_SNIPPET_START = '/*__CURSOR_LADCRAFT_LOCAL_SNIPPET_START__*/';
const EMBEDDED_SNIPPET_END = '/*__CURSOR_LADCRAFT_LOCAL_SNIPPET_END__*/';
const EMBEDDED_WIDGET_PREFIX = '/*__CURSOR_LADCRAFT_WIDGET_NAME__=';

function extractWidgetNameFromLocalCode(code: string): string | null {
	const explicitMatch = code.match(/returnResultInWidget\(\s*['"`]([^'"`]+)['"`]/);
	if (explicitMatch?.[1]) {
		return explicitMatch[1].trim();
	}
	const embeddedMatch = code.match(/__CURSOR_LADCRAFT_WIDGET_NAME__=([^\*]+)\*\//);
	return embeddedMatch?.[1]?.trim() || null;
}

function extractEmbeddedLocalSnippet(
	source: string
): { snippet: string; widgetName: string | null } | null {
	const start = source.indexOf(EMBEDDED_SNIPPET_START);
	const end = source.indexOf(EMBEDDED_SNIPPET_END);
	if (start < 0 || end < 0 || end <= start) {
		return null;
	}
	const snippet = source
		.slice(start + EMBEDDED_SNIPPET_START.length, end)
		.replace(/^\s+|\s+$/g, '');
	const widgetMatch = source.match(/\/\*__CURSOR_LADCRAFT_WIDGET_NAME__=([^\*]+)\*\//);
	return { snippet, widgetName: widgetMatch?.[1]?.trim() || null };
}

function hasLocalVmHandlerBootstrapSuffix(source: string): boolean {
	const trimmed = source.trim();
	const bootstrapIndex = trimmed.lastIndexOf(
		'const __result = await handler({ environment: { app: {}, user: {} }, capabilities: {} }, input);'
	);
	if (bootstrapIndex < 0) {
		return false;
	}
	const tail = trimmed.slice(bootstrapIndex).trim();
	const tailLines = tail
		.split('\n')
		.map((line) => line.trim())
		.filter(Boolean);
	if (tailLines.length < 2) {
		return false;
	}
	const lastLine = tailLines[tailLines.length - 1];
	return (
		lastLine === 'returnResult(__result);' ||
		/^returnResultInWidget\(\s*['"`][^'"`]+['"`]\s*,\s*__result\s*\);$/.test(lastLine)
	);
}

function stripLocalVmHandlerBootstrapSuffix(source: string): string {
	const trimmed = source.trim();
	const bootstrapMarker =
		'const __result = await handler({ environment: { app: {}, user: {} }, capabilities: {} }, input);';
	const bootstrapIndex = trimmed.lastIndexOf(bootstrapMarker);
	if (bootstrapIndex < 0 || !hasLocalVmHandlerBootstrapSuffix(trimmed)) {
		return trimmed;
	}
	return trimmed.slice(0, bootstrapIndex).trim();
}

function resolveCapabilitiesRequiredForLocalScript(code: string): LadcraftCapabilityRequirement[] {
	const required: LadcraftCapabilityRequirement[] = [];
	if (/\bskillStorage\b/.test(code)) {
		required.push({
			type: 'key-value-storage',
			operations: ['Get', 'Set'],
			scope: '$USER'
		});
	}
	if (/\bvfs\b/.test(code)) {
		required.push({
			type: 'vfs',
			operations: ['readFile', 'writeFile', 'listDir', 'mkdir', 'rm'],
			scope: '$USER'
		});
	}
	return required;
}

function analyzeScriptCodeForLadcraftRuntime(code: string): LadcraftScriptRuntimeAnalysis {
	const usesSkillStorage = /\bskillStorage\b/.test(code);
	const usesVfs = /\bvfs\b/.test(code);
	const usesGetOAuthToken = /\bgetOAuthToken\b/.test(code);
	const usesGetTelegramChatId = /\bgetTelegramChatId\b/.test(code);
	const usesRequire = /\brequire\s*\(/.test(code);
	const usesFs =
		/\bfs\./.test(code) ||
		/\bfrom\s+['"]node:fs['"]/.test(code) ||
		/\bfrom\s+['"]fs['"]/.test(code);
	const usesPath =
		/\bpath\./.test(code) ||
		/\bfrom\s+['"]node:path['"]/.test(code) ||
		/\bfrom\s+['"]path['"]/.test(code);
	const usesBuffer = /\bBuffer\b/.test(code);
	const handlerStyle = /\basync\s+function\s+handler\s*\(/.test(code)
		? 'native-handler'
		: 'legacy-script-input';
	const hasLocalVmBootstrap = hasLocalVmHandlerBootstrapSuffix(code);
	const warnings: LadcraftDeployDiagnosticMessage[] = [];

	if (usesSkillStorage) {
		warnings.push({
			level: 'info',
			code: 'uses-skill-storage',
			message:
				'Скрипт использует skillStorage; при деплое будет добавлен capability key-value-storage (runtime KV).'
		});
	}
	if (usesVfs) {
		warnings.push({
			level: 'info',
			code: 'uses-vfs',
			message: 'Скрипт использует vfs; при деплое будет добавлен capability vfs (агентский RunVfs).'
		});
	}
	if (usesRequire) {
		warnings.push({
			level: 'warn',
			code: 'uses-require',
			message: 'Скрипт использует require(); проверь совместимость с Ladcraft runtime.'
		});
	}
	if (usesFs) {
		warnings.push({
			level: 'warn',
			code: 'uses-fs',
			message:
				'Скрипт обращается к fs; в Ladcraft runtime это обычно недоступно без отдельной capability.'
		});
	}
	if (usesPath) {
		warnings.push({
			level: 'warn',
			code: 'uses-path',
			message: 'Скрипт использует path; проверь, что это действительно нужно в Ladcraft runtime.'
		});
	}
	if (usesBuffer) {
		warnings.push({
			level: 'warn',
			code: 'uses-buffer',
			message: 'Скрипт использует Buffer; проверь совместимость и размер payload.'
		});
	}
	if (hasLocalVmBootstrap) {
		warnings.push({
			level: 'info',
			code: 'has-local-vm-bootstrap',
			message: 'Обнаружен хвост local VM bootstrap; при публикации он будет обрезан.'
		});
	}

	return {
		usesSkillStorage,
		usesVfs,
		usesGetOAuthToken,
		usesGetTelegramChatId,
		usesRequire,
		usesFs,
		usesPath,
		usesBuffer,
		handlerStyle,
		hasLocalVmBootstrapSuffix: hasLocalVmBootstrap,
		networkHostsInScript: extractNetworkHostsFromContent(code),
		capabilitiesRequired: resolveCapabilitiesRequiredForLocalScript(code),
		warnings
	};
}

function buildWidgetDeployWarnings(
	widgetName: string,
	widgetSource: string
): LadcraftDeployDiagnosticMessage[] {
	if (!hasHandlebarsBlockSyntax(widgetSource)) {
		return [];
	}
	return [
		{
			level: 'warn',
			code: 'widget-handlebars-block-syntax',
			message:
				`Виджет ${widgetName} использует Handlebars-блоки {{#...}}/{{/...}}; при publish widget отправляется как EJS/HTML, поэтому переведи шаблон на <% %>.`
		}
	];
}

function buildLadcraftDeployDiagnostics(payload: LocalSkillPayload): LadcraftDeployDiagnostics {
	const widgets = payload.widgets.filter((item) => asRecord(item) != null);
	const widgetDiagnostics: LadcraftWidgetDeployDiagnostics[] = widgets.map((widget) => {
		const name = String(widget.name ?? 'widget');
		const source = buildWidgetHtmlSource(widget);
		return {
			name,
			widgetExternalHosts: extractNetworkHostsFromContent(source),
			warnings: buildWidgetDeployWarnings(name, source)
		};
	});
	const scripts: LadcraftScriptDeployDiagnostics[] = payload.scripts.map((script) => {
		const runtime = analyzeScriptCodeForLadcraftRuntime(script.code);
		const { widgetName, widget } = resolveWidgetForScript(payload, script);
		const widgetHosts = widget ? extractNetworkHostsFromContent(buildWidgetHtmlSource(widget)) : [];
		const widgetWarnings =
			widget && widgetName
				? buildWidgetDeployWarnings(widgetName, buildWidgetHtmlSource(widget))
				: [];
		return {
			name: script.name,
			widgetName,
			...runtime,
			networkHostsInScript: [...new Set([...runtime.networkHostsInScript, ...widgetHosts])],
			warnings: [...runtime.warnings, ...widgetWarnings]
		};
	});
	return {
		skillName: payload.name,
		scripts,
		widgets: widgetDiagnostics
	};
}

function wrapLocalCodeForLadcraftHandler(code: string, widgetName: string | null): string {
	if (/\basync\s+function\s+handler\s*\(/.test(code)) {
		return stripLocalVmHandlerBootstrapSuffix(code);
	}
	const usesEnv = /\benv\b/.test(code);
	const usesSkillStorage = /\bskillStorage\b/.test(code);
	const usesVfs = /\bvfs\b/.test(code);
	const usesGetOAuthToken = /\bgetOAuthToken\b/.test(code);
	const usesGetTelegramChatId = /\bgetTelegramChatId\b/.test(code);
	const lines = ['async function handler(state, params) {', `  ${EMBEDDED_WIDGET_PREFIX}${widgetName ?? ''}*/`, '  const input = params;'];
	if (usesEnv) {
		lines.push(
			'  const appEnv = state?.environment?.app ?? {};',
			'  const userEnv = state?.environment?.user ?? {};',
			'  const env = { ...appEnv, ...userEnv };'
		);
	}
	if (usesSkillStorage || usesVfs) {
		lines.push('  const __caps = state?.capabilities ?? {};');
	}
	if (usesSkillStorage) {
		lines.push(
			'  const __kvRaw = __caps.skillStorage ?? __caps.storage ?? __caps["key-value-storage"];',
			'  const skillStorage = __kvRaw && typeof __kvRaw.get === "function" ? __kvRaw : null;'
		);
	}
	if (usesVfs) {
		lines.push(
			'  const vfs = (function __ladcraftVfsAdapter(raw) {',
			'    if (!raw || typeof raw !== "object") return null;',
			'    if (typeof raw.read === "function" && typeof raw.write === "function") return raw;',
			'    if (typeof raw.readFile !== "function" || typeof raw.writeFile !== "function") return null;',
			'    const mkdir = typeof raw.mkdir === "function" ? (p) => raw.mkdir(p) : async () => undefined;',
			'    const listDir = typeof raw.listDir === "function" ? (p) => raw.listDir(p) : async () => [];',
			'    const rm = typeof raw.rm === "function" ? (p) => raw.rm(p) : async () => undefined;',
			'    return {',
			'      read: (p) => raw.readFile(p),',
			'      write: (p, c) => raw.writeFile(p, c),',
			'      mkdir,',
			'      list: listDir,',
			'      listDir,',
			'      delete: rm',
			'    };',
			'  })(__caps.vfs);'
		);
	}
	if (usesGetOAuthToken) {
		lines.push('  const getOAuthToken = async () => null;');
	}
	if (usesGetTelegramChatId) {
		lines.push('  const getTelegramChatId = async () => null;');
	}
	lines.push(
		'  return await new Promise((resolve, reject) => {',
		'    let resolved = false;',
		'    const returnResult = (value) => { if (resolved) return; resolved = true; resolve(value); };',
		'    const returnResultInWidget = (_widget, data) => { if (resolved) return; resolved = true; resolve(data); };',
		'    (async () => {',
		`      ${EMBEDDED_SNIPPET_START}`,
		...code
			.trim()
			.split('\n')
			.map((line) => `      ${line}`),
		`      ${EMBEDDED_SNIPPET_END}`,
		'    })().then((value) => {',
		'      if (!resolved && value !== undefined) {',
		'        resolved = true;',
		'        resolve(value);',
		'      }',
		'    }).catch(reject);',
		'  });',
		'}'
	);
	return lines.join('\n');
}

function convertLadcraftFunctionToLocalCode(
	functionSource: string,
	widgetName: string | null
): string {
	return normalizeToolCodeForStorage(functionSource, widgetName);
}

function buildWidgetHtmlSource(widget: Record<string, unknown>): string {
	const externalLibraries = Array.isArray(widget.external_libraries)
		? widget.external_libraries
		: [];
	const widgetScripts = Array.isArray(widget.scripts) ? widget.scripts : [];
	const externalLibrariesHtml = externalLibraries
		.map((item) => {
			const record = asRecord(item);
			if (!record) return '';
			if (record.type === 'css' && typeof record.url === 'string') {
				return `<link rel="stylesheet" href="${record.url}">`;
			}
			if (record.type === 'js' && typeof record.url === 'string') {
				return `<script src="${record.url}"></script>`;
			}
			return '';
		})
		.filter(Boolean)
		.join('\n');
	const scriptsHtml = widgetScripts
		.map((item) => {
			const record = asRecord(item);
			if (!record) return '';
			if (record.type === 'url' && typeof record.url === 'string') {
				return `<script src="${record.url}"></script>`;
			}
			if (record.type === 'inline' && typeof record.content === 'string') {
				return `<script>\n${record.content}\n</script>`;
			}
			return '';
		})
		.filter(Boolean)
		.join('\n');
	const template = typeof widget.template === 'string' ? widget.template.trim() : '';
	return [externalLibrariesHtml, template, scriptsHtml].filter(Boolean).join('\n\n');
}

function extractNetworkHostsFromContent(content: string): string[] {
	const hosts = new Set<string>();
	const matches = content.matchAll(/https?:\/\/([^\/"'`\s)]+)/g);
	for (const match of matches) {
		if (match[1]) {
			hosts.add(match[1]);
		}
	}
	return [...hosts];
}

function resolveWidgetForScript(
	payload: LocalSkillPayload,
	script: LocalSkillScript
): { widgetName: string | null; widget: Record<string, unknown> | null } {
	const explicitWidgetName = extractWidgetNameFromLocalCode(script.code);
	const widgets = payload.widgets.filter((item) => asRecord(item) != null);
	if (explicitWidgetName) {
		const widget =
			widgets.find((item) => String(item.name ?? '').trim() === explicitWidgetName) ?? null;
		return { widgetName: explicitWidgetName, widget };
	}
	const bySameName = widgets.find((item) => String(item.name ?? '').trim() === script.name) ?? null;
	if (bySameName) {
		return { widgetName: String(bySameName.name ?? script.name), widget: bySameName };
	}
	if (payload.scripts.length === 1 && widgets.length === 1) {
		const widget = widgets[0]!;
		return { widgetName: String(widget.name ?? script.name), widget };
	}
	return { widgetName: null, widget: null };
}

let cachedDefaultLadcraftCategory: string | null = null;

async function resolveDefaultLadcraftCategory(): Promise<string> {
	if (cachedDefaultLadcraftCategory) {
		return cachedDefaultLadcraftCategory;
	}
	const remote = await requestLadcraft('GET', '/v1/application/category/list');
	if (remote.status !== 200) {
		throw new DevServerHttpError(
			remote.status,
			extractApiErrorMessage(remote.data, 'Не удалось загрузить категории Ladcraft')
		);
	}
	const categories = unwrapApiEnvelope(remote.data);
	const ids = Array.isArray(categories)
		? categories
				.map((item) => {
					const record = asRecord(item);
					return typeof record?.id === 'string' ? record.id.trim() : '';
				})
				.filter(Boolean)
		: [];
	const preferred = ['productivity', 'AI', 'data_analysis'].find((id) => ids.includes(id));
	cachedDefaultLadcraftCategory = preferred || ids[0] || 'productivity';
	return cachedDefaultLadcraftCategory;
}

function parseCapabilityCatalogItems(payload: unknown): LadcraftCapabilityCatalogItem[] {
	const unwrapped = unwrapApiEnvelope(payload);
	const candidates: unknown[] = [];
	if (Array.isArray(unwrapped)) candidates.push(unwrapped);
	const record = asRecord(unwrapped);
	if (record) {
		if (Array.isArray(record.items)) candidates.push(record.items);
		if (Array.isArray(record.capabilities)) candidates.push(record.capabilities);
		if (Array.isArray(record.list)) candidates.push(record.list);
		if (Array.isArray(record.data)) candidates.push(record.data);
		if (Array.isArray(record.results)) candidates.push(record.results);
		const entriesAsArray = Object.entries(record)
			.filter(([, value]) => value && typeof value === 'object' && !Array.isArray(value))
			.map(([key, value]) => ({ key, ...(value as Record<string, unknown>) }));
		if (entriesAsArray.length > 0) candidates.push(entriesAsArray);
	}

	const parseStringArray = (raw: unknown): string[] => {
		if (!Array.isArray(raw)) return [];
		return raw
			.map((entry) => {
				if (typeof entry === 'string') return entry.trim();
				const r = asRecord(entry);
				if (!r) return '';
				const candidate =
					typeof r.value === 'string'
						? r.value
						: typeof r.runtimeName === 'string'
								? r.runtimeName
								: typeof r.name === 'string'
									? r.name
							: typeof r.id === 'string'
								? r.id
								: '';
				return candidate.trim();
			})
			.filter(Boolean);
	};
	for (const candidate of candidates) {
		if (!Array.isArray(candidate)) continue;
		const out: LadcraftCapabilityCatalogItem[] = [];
		for (const raw of candidate) {
			const item = asRecord(raw);
			if (!item) continue;
			const type =
				typeof item.type === 'string'
					? item.type.trim()
					: typeof item.id === 'string'
						? item.id.trim()
						: typeof item.key === 'string'
							? item.key.trim()
							: typeof item.value === 'string'
								? item.value.trim()
								: typeof item.code === 'string'
									? item.code.trim()
									: '';
			if (!type) continue;
			const operationsRaw = parseStringArray(
				Array.isArray(item.operations)
					? item.operations
					: Array.isArray(item.available_operations)
						? item.available_operations
						: Array.isArray(item.ops)
							? item.ops
							: []
			);
			const operationObjects = Array.isArray(item.operations)
				? item.operations
				: Array.isArray(item.available_operations)
					? item.available_operations
					: [];
			const operationDescriptions: Record<string, string> = {};
			for (const op of operationObjects) {
				const opRecord = asRecord(op);
				if (!opRecord) continue;
				const runtimeName =
					typeof opRecord.runtimeName === 'string' ? opRecord.runtimeName.trim() : '';
				const displayName = typeof opRecord.name === 'string' ? opRecord.name.trim() : '';
				if (!runtimeName && !displayName) continue;
				const opDescription =
					typeof opRecord.description === 'string' ? opRecord.description.trim() : '';
				if (opDescription) {
					if (runtimeName) operationDescriptions[runtimeName] = opDescription;
					if (displayName) operationDescriptions[displayName] = opDescription;
				}
			}
			const scopesRaw = parseStringArray(
				Array.isArray(item.scopes)
					? item.scopes
					: Array.isArray(item.available_scopes)
						? item.available_scopes
						: Array.isArray(item.scope_values)
							? item.scope_values
							: []
			);
			const scopesFromRuntimeArgs = new Set<string>();
			for (const op of operationObjects) {
				const opRecord = asRecord(op);
				if (!opRecord) continue;
				const runtimeArgs = Array.isArray(opRecord.runtimeArgs) ? opRecord.runtimeArgs : [];
				for (const arg of runtimeArgs) {
					const argRecord = asRecord(arg);
					if (!argRecord) continue;
					const argName = typeof argRecord.name === 'string' ? argRecord.name.trim() : '';
					if (argName !== 'scope') continue;
					const argSchema = asRecord(argRecord.schema);
					const enumValuesRaw = argSchema ? (argSchema.enum as unknown) : undefined;
					const enumValues = Array.isArray(enumValuesRaw) ? enumValuesRaw : [];
					for (const enumValue of enumValues) {
						if (typeof enumValue === 'string' && enumValue.trim()) {
							scopesFromRuntimeArgs.add(enumValue.trim());
						}
					}
				}
			}
			const label =
				typeof item.title === 'string'
					? item.title.trim()
					: typeof item.name === 'string'
						? item.name.trim()
						: typeof item.label === 'string'
							? item.label.trim()
							: type;
			const description =
				typeof item.description === 'string'
					? item.description.trim()
					: typeof item.hint === 'string'
						? item.hint.trim()
						: undefined;
			out.push({
				type,
				label,
				description,
				operations: operationsRaw,
				operation_descriptions:
					Object.keys(operationDescriptions).length > 0 ? operationDescriptions : undefined,
				scopes:
					scopesRaw.length > 0
						? scopesRaw
						: scopesFromRuntimeArgs.size > 0
							? [...scopesFromRuntimeArgs]
							: ['$APP', '$USER']
			});
		}
		if (out.length > 0) return out;
	}
	return [];
}

async function fetchLadcraftCapabilitiesCatalog(): Promise<{
	catalog: LadcraftCapabilityCatalogItem[];
	source: 'api';
	warning?: string;
}> {
	const remote = await requestLadcraft('GET', '/v1/application/capabilities');
	if (remote.status < 200 || remote.status >= 300) {
		throw new DevServerHttpError(
			remote.status,
			extractApiErrorMessage(
				remote.data,
				'Не удалось загрузить каталог разрешений из Ladcraft API для текущего окружения'
			)
		);
	}
	const parsed = parseCapabilityCatalogItems(remote.data);
	if (parsed.length === 0) {
		throw new DevServerHttpError(502, 'Ladcraft API вернул пустой каталог разрешений');
	}
	return { catalog: parsed, source: 'api' };
}

/** Соответствие tool.environment из mcp_spec.tools[].name → script.name */
function resolveMcpToolEnvironment(
	mcpSpec: Record<string, unknown> | null | undefined,
	toolName: string
): {
	app: Record<string, string>;
	user: Record<string, { title: string; format: string }>;
} {
	const emptyApp: Record<string, string> = {};
	const emptyUser: Record<string, { title: string; format: string }> = {};
	if (!mcpSpec) {
		return { app: emptyApp, user: emptyUser };
	}
	const tools = Array.isArray(mcpSpec.tools) ? mcpSpec.tools : [];
	const normalizedTarget = toolName.trim();
	for (const raw of tools) {
		const t = asRecord(raw);
		const name = typeof t?.name === 'string' ? t.name.trim() : '';
		if (name !== normalizedTarget) continue;
		const env = asRecord(t?.environment);
		if (!env) {
			return { app: emptyApp, user: emptyUser };
		}
		const app: Record<string, string> = {};
		const appRaw = asRecord(env.app);
		if (appRaw) {
			for (const [k, v] of Object.entries(appRaw)) {
				if (typeof v === 'string') app[k] = v;
				else if (typeof v === 'number' || typeof v === 'boolean') app[k] = String(v);
			}
		}
		const user: Record<string, { title: string; format: string }> = {};
		const userRaw = asRecord(env.user);
		if (userRaw) {
			for (const [k, v] of Object.entries(userRaw)) {
				const vr = asRecord(v);
				const title =
					typeof vr?.title === 'string' && vr.title.trim().length > 0
						? vr.title.trim()
						: k;
				const format =
					typeof vr?.format === 'string' && vr.format.trim().length > 0
						? vr.format.trim()
						: 'string';
				user[k] = { title, format };
			}
		}
		return { app, user };
	}
	return { app: emptyApp, user: emptyUser };
}

/** Явные capability из `mcp_spec.default_capabilities.required` (мержатся с автоопределением по коду). */
function parseRawCapabilityRequirement(raw: unknown): LadcraftCapabilityRequirement | null {
	const r = asRecord(raw);
	if (!r) return null;
	const type = typeof r.type === 'string' ? r.type.trim() : '';
	if (!type) return null;
	const opsRaw = r.operations;
	const operations = Array.isArray(opsRaw)
		? opsRaw.filter((o): o is string => typeof o === 'string' && o.trim().length > 0).map((o) => o.trim())
		: [];
	return { type, operations, scope: '$USER' };
}

function resolveMcpSpecDefaultCapabilitiesRequired(
	mcpSpec: Record<string, unknown> | null | undefined
): LadcraftCapabilityRequirement[] {
	if (!mcpSpec) return [];
	const dc = asRecord(mcpSpec.default_capabilities);
	const req = dc?.required;
	if (!Array.isArray(req)) return [];
	const out: LadcraftCapabilityRequirement[] = [];
	for (const item of req) {
		const cap = parseRawCapabilityRequirement(item);
		if (cap) out.push(normalizeCapabilityRequirementForRuntime(cap));
	}
	return out;
}

function capabilityIdentityKey(cap: LadcraftCapabilityRequirement): string {
	return `${cap.type}:${cap.scope}`;
}

function mergeCapabilitiesRequiredLists(
	auto: LadcraftCapabilityRequirement[],
	explicit: LadcraftCapabilityRequirement[]
): LadcraftCapabilityRequirement[] {
	const map = new Map<string, LadcraftCapabilityRequirement>();
	for (const cap of auto.map(normalizeCapabilityRequirementForRuntime)) {
		map.set(capabilityIdentityKey(cap), cap);
	}
	for (const cap of explicit.map(normalizeCapabilityRequirementForRuntime)) {
		map.set(capabilityIdentityKey(cap), cap);
	}
	return [...map.values()];
}

async function convertLocalSkillToLadcraftPayload(
	payload: LocalSkillPayload,
	options?: { skillNameOverride?: string | null }
): Promise<LadcraftDeployPayload> {
	const effectivePayload: LocalSkillPayload = {
		...payload,
		scripts: [...(payload.scripts ?? [])],
		widgets: [...(payload.widgets ?? [])]
	};
	ensureWidgetScript(effectivePayload);
	const category = await resolveDefaultLadcraftCategory();
	const mcpSpecRecord = asRecord(effectivePayload.mcp_spec) ?? null;
	const defaultCaps = resolveMcpSpecDefaultCapabilitiesRequired(mcpSpecRecord);
	const tools = effectivePayload.scripts.map((script) => {
		const { widgetName, widget } = resolveWidgetForScript(effectivePayload, script);
		const widgetSource = widget ? buildWidgetHtmlSource(widget) : '';
		const networkHosts = new Set<string>([
			...((script.resources?.network?.hosts ?? []).map((h) => String(h).trim()).filter(Boolean)),
			...extractNetworkHostsFromContent(script.code),
			...extractNetworkHostsFromContent(widgetSource)
		]);
		const scriptResources = script.resources ?? {};
		const cpu =
			typeof scriptResources.cpu === 'number' && Number.isFinite(scriptResources.cpu)
				? scriptResources.cpu
				: 0.2;
		const memory =
			typeof scriptResources.memory === 'number' && Number.isFinite(scriptResources.memory)
				? scriptResources.memory
				: 128;
		const timeout =
			typeof scriptResources.timeout === 'number' && Number.isFinite(scriptResources.timeout)
				? scriptResources.timeout
				: 30;
		const gpu =
			typeof scriptResources.gpu === 'number' && Number.isFinite(scriptResources.gpu)
				? scriptResources.gpu
				: undefined;
		const { app: envApp, user: envUser } = resolveMcpToolEnvironment(
			effectivePayload.mcp_spec ?? null,
			script.name
		);
		const autoCaps = resolveCapabilitiesRequiredForLocalScript(script.code);
		const mergedCaps =
			defaultCaps.length > 0 ? mergeCapabilitiesRequiredLists(autoCaps, defaultCaps) : autoCaps.map(normalizeCapabilityRequirementForRuntime);
		return {
			name: script.name,
			description: script.description?.trim() || `Инструмент ${script.name}`,
			capabilities: { required: mergedCaps },
			environment: {
				app: Object.keys(envApp).length > 0 ? envApp : {},
				user: Object.keys(envUser).length > 0 ? envUser : {}
			},
			resources: {
				cpu,
				...(gpu !== undefined ? { gpu } : {}),
				memory,
				timeout,
				network: { hosts: [...networkHosts] }
			},
			schemas: {
				input: script.input_schema ?? {
					type: 'object',
					properties: {},
					required: [],
					additionalProperties: false
				},
				...(script.output_schema ? { output: script.output_schema } : {})
			},
			function: normalizeToolCodeForStorage(script.code, widgetName),
			...(widgetSource ? { widget: widgetSource } : {})
		};
	});
	return {
		name: options?.skillNameOverride?.trim() || effectivePayload.name.trim(),
		description: effectivePayload.description.trim(),
		skill: effectivePayload.body.trim(),
		version: '1.0.0',
		author: 'cursor_ladcraft',
		license: 'MIT',
		tags: [],
		category,
		icon: '',
		cover: '',
		tools
	};
}

function convertLadcraftSkillToLocal(details: LadcraftApplicationDetails): LocalSkillPayload {
	const tools = Array.isArray(details.tools) ? details.tools : [];
	const scripts: LocalSkillScript[] = [];
	const widgets: Array<Record<string, unknown>> = [];
	const mcpTools: Array<Record<string, unknown>> = [];
	const defaultCapsRequired = extractDefaultCapabilitiesRequiredFromTools(
		tools as Array<Record<string, unknown>>
	);
	for (const tool of tools) {
		const toolName = typeof tool.name === 'string' ? tool.name.trim() : 'tool';
		const toolDescription = typeof tool.description === 'string' ? tool.description : '';
		const schemas = asRecord(tool.schemas);
		const inputSchema = asRecord(schemas?.input) ?? {
			type: 'object',
			properties: {},
			required: []
		};
		const outputSchema = asRecord(schemas?.output) ?? null;
		const widgetHtml = typeof tool.widget === 'string' ? tool.widget : '';
		const functionSource = typeof tool.function === 'string' ? tool.function : '';
		const embedded = extractEmbeddedLocalSnippet(functionSource);
		const widgetName = embedded?.widgetName || (widgetHtml ? `${toolName}` : null);
		const toolResources = asRecord((tool as Record<string, unknown>)?.resources);
		const network = asRecord(toolResources?.network);
		const networkHostsRaw = network ? (network.hosts as unknown) : undefined;
		const parsedResources: LocalSkillScript['resources'] = {
			...(typeof toolResources?.cpu === 'number' && Number.isFinite(toolResources.cpu)
				? { cpu: toolResources.cpu }
				: {}),
			...(typeof toolResources?.gpu === 'number' && Number.isFinite(toolResources.gpu)
				? { gpu: toolResources.gpu }
				: {}),
			...(typeof toolResources?.memory === 'number' && Number.isFinite(toolResources.memory)
				? { memory: toolResources.memory }
				: {}),
			...(typeof toolResources?.timeout === 'number' && Number.isFinite(toolResources.timeout)
				? { timeout: toolResources.timeout }
				: {}),
			...(Array.isArray(networkHostsRaw)
				? {
						network: {
							hosts: networkHostsRaw
								.filter((h): h is string => typeof h === 'string')
								.map((h) => h.trim())
								.filter(Boolean)
						}
					}
				: {})
		};
		const environment = asRecord((tool as Record<string, unknown>)?.environment);
		const mcpTool: Record<string, unknown> = { name: toolName };
		if (environment) {
			const appEnv = asRecord(environment.app);
			const userEnv = asRecord(environment.user);
			const nextEnv: Record<string, unknown> = {};
			if (appEnv && Object.keys(appEnv).length > 0) nextEnv.app = appEnv;
			if (userEnv && Object.keys(userEnv).length > 0) nextEnv.user = userEnv;
			if (Object.keys(nextEnv).length > 0) mcpTool.environment = nextEnv;
		}
		mcpTools.push(mcpTool);
		scripts.push({
			name: toolName,
			description: toolDescription,
			input_schema: inputSchema,
			output_schema: outputSchema,
			script_file: `${toolName}.js`,
			code: convertLadcraftFunctionToLocalCode(functionSource, widgetName),
			auth: null,
			...(Object.keys(parsedResources).length > 0 ? { resources: parsedResources } : {})
		});
		if (widgetHtml && widgetName) {
			widgets.push({
				name: widgetName,
				description: `Виджет ${toolName}`,
				schema: outputSchema ?? { type: 'object', properties: {}, required: [] },
				template: widgetHtml,
				scripts: [],
				external_libraries: []
			});
		}
	}
	return {
		name: getApplicationDisplayName(details) || details.id,
		description: details.description ?? '',
		body: details.skill ?? details.detailed_description ?? '',
		scripts,
		widgets,
		mcp_spec:
			mcpTools.length > 0 || defaultCapsRequired.length > 0
				? {
						...(mcpTools.length > 0 ? { tools: mcpTools } : {}),
						...(defaultCapsRequired.length > 0
							? {
									default_capabilities: {
										required: defaultCapsRequired
									}
								}
							: {})
					}
				: null
	};
}

function extractInstalledSkillInstallationFormValues(
	details: LadcraftApplicationDetails
): InstallationFormByTool {
	const values: InstallationFormByTool = {};
	const tools = Array.isArray(details.tools) ? details.tools : [];
	for (const tool of tools) {
		const toolRecord = asRecord(tool);
		const toolName = typeof toolRecord?.name === 'string' ? toolRecord.name.trim() : '';
		if (!toolName) continue;
		const env = asRecord((tool as Record<string, unknown>)?.environment);
		const user = asRecord(env?.user);
		if (!user) continue;
		const out: Record<string, InstallationFormValue> = {};
		for (const [key, value] of Object.entries(user)) {
			if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
				out[key] = value;
			}
		}
		if (Object.keys(out).length > 0) values[toolName] = out;
	}
	return values;
}

function normalizeSkillName(value: string): string {
	return value.trim().replace(/\s+/g, ' ').toLowerCase();
}

const deployHistoryFile = path.join(path.dirname(config.skillStorageFile), 'deploy-history.json');
const installFormDraftsFile = path.join(
	path.dirname(config.skillStorageFile),
	'installation-form-drafts.json'
);

function installationFormDraftSkillKey(skillName: string): string {
	return skillName.trim().toLowerCase();
}

async function loadInstallationFormDrafts(): Promise<Record<string, InstallationFormByTool>> {
	try {
		if (!existsSync(installFormDraftsFile)) return {};
		const raw = await readFile(installFormDraftsFile, 'utf-8');
		const parsed = JSON.parse(raw);
		if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
		const out: Record<string, InstallationFormByTool> = {};
		for (const [skillKey, draftRaw] of Object.entries(parsed as Record<string, unknown>)) {
			const parsedDraft = installationFormByToolSchema.safeParse(draftRaw);
			if (parsedDraft.success) out[skillKey] = parsedDraft.data;
		}
		return out;
	} catch {
		return {};
	}
}

async function saveInstallationFormDrafts(
	drafts: Record<string, InstallationFormByTool>
): Promise<void> {
	await mkdir(path.dirname(installFormDraftsFile), { recursive: true });
	await writeFile(installFormDraftsFile, JSON.stringify(drafts, null, 2), 'utf-8');
}

async function saveInstallationFormDraft(skillName: string, form: InstallationFormByTool): Promise<void> {
	const key = installationFormDraftSkillKey(skillName);
	if (!key) return;
	const drafts = await loadInstallationFormDrafts();
	drafts[key] = form;
	await saveInstallationFormDrafts(drafts);
}

async function readInstallationFormDraft(skillName: string): Promise<InstallationFormByTool> {
	const key = installationFormDraftSkillKey(skillName);
	if (!key) return {};
	const drafts = await loadInstallationFormDrafts();
	return drafts[key] ?? {};
}

function resolveUserEnvironmentForScript(
	draft: InstallationFormByTool,
	scriptName: string
): Record<string, string> {
	const out: Record<string, string> = {};
	const toolForm = draft[scriptName];
	if (toolForm) {
		for (const [key, value] of Object.entries(toolForm)) {
			if (value != null) out[key] = String(value);
		}
	}
	for (const form of Object.values(draft)) {
		for (const [key, value] of Object.entries(form)) {
			if (!key.startsWith('SSH_')) continue;
			if (out[key] === undefined && value != null) out[key] = String(value);
		}
	}
	return out;
}

async function loadDeployHistory(): Promise<DeployHistoryEntry[]> {
	try {
		if (!existsSync(deployHistoryFile)) return [];
		const raw = await readFile(deployHistoryFile, 'utf-8');
		const parsed = JSON.parse(raw);
		return Array.isArray(parsed) ? (parsed as DeployHistoryEntry[]) : [];
	} catch {
		return [];
	}
}

async function saveDeployHistory(entries: DeployHistoryEntry[]): Promise<void> {
	await mkdir(path.dirname(deployHistoryFile), { recursive: true });
	await writeFile(deployHistoryFile, JSON.stringify(entries, null, 2), 'utf-8');
}

async function appendDeployHistory(
	entry: Omit<DeployHistoryEntry, 'id' | 'createdAt'>
): Promise<DeployHistoryEntry> {
	const history = await loadDeployHistory();
	const next: DeployHistoryEntry = {
		id: history.length > 0 ? Math.max(...history.map((item) => item.id)) + 1 : 1,
		createdAt: new Date().toISOString(),
		...entry
	};
	await saveDeployHistory([next, ...history].slice(0, 500));
	return next;
}

function buildDeployDiffSummary(
	localPayload: LocalSkillPayload,
	remoteDetails: LadcraftApplicationDetails | null
): DeployDryRunResult['diffSummary'] {
	const out: DeployDryRunResult['diffSummary'] = {
		skill: [],
		tools: [],
		mcpSpecEnvironment: [],
		widgets: []
	};
	if (!remoteDetails) {
		out.skill.push('новый навык: удалённая версия отсутствует');
		out.tools.push(`будет добавлено инструментов: ${localPayload.scripts.length}`);
		return out;
	}
	const localBody = localPayload.body.trim();
	const remoteBody = (remoteDetails.skill ?? remoteDetails.detailed_description ?? '').trim();
	if (localBody !== remoteBody) out.skill.push('изменится текст SKILL');

	const remoteTools = new Map(
		(Array.isArray(remoteDetails.tools) ? remoteDetails.tools : []).map((tool) => [
			String((tool as Record<string, unknown>).name ?? ''),
			tool as Record<string, unknown>
		])
	);
	const mcpSpec = asRecord(localPayload.mcp_spec);
	for (const script of localPayload.scripts) {
		const remoteTool = remoteTools.get(script.name);
		if (!remoteTool) {
			out.tools.push(`добавится tool: ${script.name}`);
			continue;
		}
		if (String(remoteTool.description ?? '') !== String(script.description ?? '')) {
			out.tools.push(`изменится описание tool: ${script.name}`);
		}
		const remoteFunction = String(remoteTool.function ?? '').trim();
		if (remoteFunction && remoteFunction !== script.code.trim()) {
			out.tools.push(`изменится код tool: ${script.name}`);
		}
		const env = resolveMcpToolEnvironment(mcpSpec, script.name);
		const remoteEnv = asRecord(remoteTool.environment);
		if (
			JSON.stringify(env.user) !== JSON.stringify(asRecord(remoteEnv?.user) ?? {}) ||
			JSON.stringify(env.app) !== JSON.stringify(asRecord(remoteEnv?.app) ?? {})
		) {
			out.mcpSpecEnvironment.push(`изменится environment у tool: ${script.name}`);
		}
	}
	return out;
}

function buildLocalSkillValidationReport(payload: LocalSkillPayload): SkillValidationReport {
	const issues: SkillValidationIssue[] = [];
	const hasBody = payload.body.trim().length > 0;
	const hasScripts = Array.isArray(payload.scripts) && payload.scripts.length > 0;
	const hasWidgets = Array.isArray(payload.widgets) && payload.widgets.length > 0;
	if (!payload.name.trim()) {
		issues.push({
			severity: 'error',
			source: 'structure',
			filePath: 'SKILL.md',
			message: 'Заполните название навыка.',
			code: null,
			line: null,
			column: null
		});
	}
	if (!payload.description.trim()) {
		issues.push({
			severity: 'error',
			source: 'structure',
			filePath: 'SKILL.md',
			message: 'Заполните описание навыка.',
			code: null,
			line: null,
			column: null
		});
	}
	if (!hasBody && !hasScripts && !hasWidgets) {
		issues.push({
			severity: 'error',
			source: 'structure',
			filePath: 'SKILL.md',
			message: 'Навык должен содержать либо body, либо локальные tools/widgets.',
			code: null,
			line: null,
			column: null
		});
	}
	const files = (payload.scripts ?? []).map((script, index) => ({
		filePath: `tools/${script.name?.trim() || `tool-${index + 1}`}.js`,
		content: normalizeToolCodeForStorage(
			script.code ?? '',
			extractWidgetNameFromLocalCode(script.code ?? '')
		),
		inputSchema: script.input_schema ?? {
			type: 'object',
			properties: {},
			required: [],
			additionalProperties: false
		},
		outputSchema: script.output_schema ?? {
			type: 'object',
			properties: {}
		}
	}));
	return createPayloadValidationReport(
		payload.name.trim() || 'skill',
		files,
		issues,
		buildBuilderLadcraftDeployDiagnostics(payload)
	);
}

function findExistingLadcraftSkillByName(
	items: LadcraftApplicationListItem[],
	skillName: string
): LadcraftApplicationListItem | null {
	const normalizedTarget = normalizeSkillName(skillName);
	return (
		items.find(
			(item) => normalizeSkillName(getApplicationDisplayName(item)) === normalizedTarget
		) ?? null
	);
}

async function linkLocalSkillToRemote(skillName: string, remoteSkillId: string): Promise<void> {
	const entry = await findLocalSkillEntry(skillName);
	if (!entry) return;
	const metaPath = path.join(entry.filePath, '.from-server.json');
	await writeFile(
		metaPath,
		JSON.stringify({ skillId: remoteSkillId, syncedAt: new Date().toISOString() }, null, 2),
		'utf-8'
	);
}

app.get('/api/remote/skills', async (_req, res) => {
	try {
		const remoteSkills = await listLadcraftAuthoredSkillsDirect();
		const result: Array<{
			id: string;
			name: string;
			isNew: boolean;
			hasConflict: boolean;
			identityKey: string;
		}> = [];
		if (remoteSkills.length === 0) {
			res.status(200).json({ skills: result });
			return;
		}
		await ensureSkillsDir();
		await mkdir(remoteCacheDir, { recursive: true });
		for (const remoteSkill of remoteSkills) {
			try {
				const skillId = remoteSkill.id;
				const skillName = getApplicationDisplayName(remoteSkill) || skillId;
				const details = await getLadcraftSkillDetailsDirect(skillId);
				const localPayload = convertLadcraftSkillToLocal(details);
				const existingEntryBeforeSync = await findLocalSkillEntryInStore(
					localSkillsDir,
					skillName,
					skillId
				);
				const cachePath = getRemoteCacheFolderPath(remoteCacheDir, skillName);
				if (existsSync(cachePath)) {
					await rm(cachePath, { recursive: true });
				}
				await writeSkillToFolder(cachePath, localPayload);
				const normalizedRemotePayload = await convertFolderToPayloadJson(cachePath).catch(
					() => localPayload
				);
				const migration = await migrateLegacySkillFolder({
					localSkillsDir,
					quarantineDir: legacyConflictDir,
					skillName
				});
				let mainEntry = await findLocalSkillEntryInStore(localSkillsDir, skillName, skillId);
				const mainPath =
					mainEntry?.filePath ??
					migration.canonicalPath ??
					getCanonicalSkillFolderPath(localSkillsDir, skillName);
				const existsLocally = !!mainEntry;
				let hasConflict = false;
				if (existsLocally) {
					try {
						const localPayloadFromFolder = await convertFolderToPayloadJson(mainPath);
						hasConflict = !payloadsEqual(localPayloadFromFolder, normalizedRemotePayload);
					} catch {
						hasConflict = true;
					}
				} else if (!hasExistingSkillFolder(localSkillsDir, skillName)) {
					await writeSkillToFolder(mainPath, localPayload);
				} else {
					// Keep files untouched when folder exists but parsing failed.
					hasConflict = true;
				}
				if (skillId) {
					const metaPath = path.join(mainPath, '.from-server.json');
					await writeFile(
						metaPath,
						JSON.stringify({ skillId, syncedAt: new Date().toISOString() }, null, 2),
						'utf-8'
					);
				}
				mainEntry = await findLocalSkillEntryInStore(localSkillsDir, skillName, skillId);
				result.push({
					id: skillId,
					name: skillName,
					isNew: !existingEntryBeforeSync,
					hasConflict,
					identityKey:
						mainEntry?.identityKey ??
						getSkillIdentityKey({ name: skillName, serverSkillId: skillId || null })
				});
			} catch (err) {
				console.error('[dev-server] Error processing remote Ladcraft skill:', err);
			}
		}
		const remoteIds = new Set(result.map((r) => r.id).filter((id) => id.length > 0));
		const remoteNames = new Set(result.map((r) => r.name));
		const localEntries = await listActiveLocalSkillEntries(localSkillsDir);
		for (const entry of localEntries) {
			const metaPath = path.join(entry.filePath, '.from-server.json');
			const stillOnServer =
				typeof entry.serverSkillId === 'string' && entry.serverSkillId.length > 0
					? remoteIds.has(entry.serverSkillId)
					: remoteNames.has(entry.skill.name);
			if (entry.isFromServer && existsSync(metaPath) && !stillOnServer) {
				await unlink(metaPath);
			}
		}
		compatibilityAuditManager.schedule();
		res.status(200).json({ skills: result });
	} catch (err) {
		sendHttpError(res, err, 'Failed to fetch remote Ladcraft skills');
	}
});

app.get('/api/remote/skills/version-by-name', async (req, res) => {
	try {
		const skillName = typeof req.query.skillName === 'string' ? req.query.skillName.trim() : '';
		if (!skillName) {
			res.status(400).json({ ok: false, error: 'skillName is required' });
			return;
		}
		const list = await listLadcraftAuthoredSkillsDirect();
		const existing = findExistingLadcraftSkillByName(list, skillName);
		if (!existing) {
			res.json({ ok: true, exists: false, version: null, applicationId: null });
			return;
		}
		res.json({
			ok: true,
			exists: true,
			version: typeof existing.version === 'string' ? existing.version : null,
			applicationId: existing.id
		});
	} catch (err) {
		sendHttpError(res, err, 'Failed to resolve remote skill version', 400);
	}
});

app.get('/api/remote/capabilities/catalog', async (_req, res) => {
	try {
		const data = await fetchLadcraftCapabilitiesCatalog();
		res.json({
			ok: true,
			catalog: data.catalog,
			source: data.source,
			warning: data.warning ?? null
		});
	} catch (err) {
		sendHttpError(res, err, 'Failed to fetch capabilities catalog');
	}
});

app.get('/api/remote/skills/:skillId/installation-form-values', async (req, res) => {
	try {
		const skillId = normalizeRemoteSkillId(req.params.skillId);
		if (!skillId) {
			res.status(400).json({ ok: false, error: 'Invalid skill id' });
			return;
		}
		const remote = await requestLadcraft(
			'GET',
			'/v1/application/' + encodeURIComponent(skillId) + '?type=skill&return_installed=true'
		);
		if (remote.status !== 200) {
			res.status(remote.status).json({
				ok: false,
				error: extractApiErrorMessage(remote.data, 'Не удалось получить текущие параметры установки')
			});
			return;
		}
		const unwrapped = asRecord(unwrapApiEnvelope(remote.data));
		if (!unwrapped) {
			res.status(502).json({ ok: false, error: 'Ladcraft вернул пустые данные навыка' });
			return;
		}
		const details: LadcraftApplicationDetails = {
			id: normalizeRemoteSkillId(unwrapped.id) || skillId,
			title: typeof unwrapped.title === 'string' ? unwrapped.title : undefined,
			name: typeof unwrapped.name === 'string' ? unwrapped.name : undefined,
			description: typeof unwrapped.description === 'string' ? unwrapped.description : undefined,
			detailed_description:
				typeof unwrapped.detailed_description === 'string' ? unwrapped.detailed_description : null,
			skill: typeof unwrapped.skill === 'string' ? unwrapped.skill : null,
			version: typeof unwrapped.version === 'string' ? unwrapped.version : null,
			author: typeof unwrapped.author === 'string' ? unwrapped.author : null,
			license: typeof unwrapped.license === 'string' ? unwrapped.license : null,
			tags: Array.isArray(unwrapped.tags) ? unwrapped.tags.map(String) : [],
			category: typeof unwrapped.category === 'string' ? unwrapped.category : null,
			icon: typeof unwrapped.icon === 'string' ? unwrapped.icon : null,
			cover: typeof unwrapped.cover === 'string' ? unwrapped.cover : null,
			tools: Array.isArray(unwrapped.tools)
				? unwrapped.tools.filter((item): item is Record<string, unknown> => asRecord(item) != null)
				: [],
			updated_at: typeof unwrapped.updated_at === 'string' ? unwrapped.updated_at : undefined
		};
		res.json({ ok: true, values: extractInstalledSkillInstallationFormValues(details) });
	} catch (err) {
		sendHttpError(res, err, 'Failed to fetch installation form values');
	}
});

app.get('/api/local/skills/:skillName/ladcraft-deploy-check', async (req, res) => {
	try {
		const entry = await findLocalSkillEntry(req.params.skillName);
		if (!entry) {
			res.status(404).json({ ok: false, error: `Local skill "${req.params.skillName}" not found` });
			return;
		}
		const payload = await convertFolderToPayloadJson(entry.filePath);
		const diagnostics = buildBuilderLadcraftDeployDiagnostics(payload);
		const validationReport = buildLocalSkillValidationReport(payload);
		res.json({
			ok: true,
			skillName: payload.name,
			diagnostics,
			validationReport
		});
	} catch (err) {
		sendHttpError(res, err, 'Failed to build Ladcraft deploy diagnostics', 400);
	}
});

app.post('/api/remote/skills/accept-server', async (req, res) => {
	try {
		const parsed = acceptServerSchema.parse(req.body);
		const cachePath = getRemoteCacheFolderPath(remoteCacheDir, parsed.skillName);
		if (!existsSync(cachePath)) {
			res.status(404).json({
				ok: false,
				error: 'Skill not found in remote cache. Run "Скачать с сервера" first.'
			});
			return;
		}
		const migration = await migrateLegacySkillFolder({
			localSkillsDir,
			quarantineDir: legacyConflictDir,
			skillName: parsed.skillName
		});
		const payload = await convertFolderToPayloadJson(cachePath);
		const existingEntry = await findLocalSkillEntryInStore(
			localSkillsDir,
			parsed.skillName,
			parsed.skillId
		);
		const mainPath =
			existingEntry?.filePath ??
			migration.canonicalPath ??
			getCanonicalSkillFolderPath(localSkillsDir, parsed.skillName);
		await writeSkillToFolder(mainPath, payload);
		const metaPath = path.join(mainPath, '.from-server.json');
		await writeFile(
			metaPath,
			JSON.stringify(
				{ skillId: parsed.skillId ?? '', syncedAt: new Date().toISOString() },
				null,
				2
			),
			'utf-8'
		);
		compatibilityAuditManager.schedule();
		broadcastSseEvent('local-skills-changed');
		res.status(200).json({ ok: true, skillName: payload.name });
	} catch (err) {
		res.status(400).json({
			ok: false,
			error: err instanceof Error ? err.message : 'Failed to accept server version'
		});
	}
});

async function publishLocalSkillToLadcraft(
	payload: LocalSkillPayload,
	options?: {
		mode?: 'create' | 'update' | 'upsert';
		skillId?: string | null;
		createAsName?: string | null;
		installationForm?: InstallationFormByTool | null;
	}
): Promise<{
	applicationId: string;
	modeUsed: 'create' | 'update';
	installedApplicationId?: string;
	installSyncSkipped?: boolean;
	fromVersion?: string;
	autoInstallStatus?: 'updated' | 'installed' | 'skipped' | 'failed';
}> {
	let installationFormByTool = options?.installationForm ?? null;
	let installationFormFlat = flattenInstallationFormByTool(installationFormByTool);
	let hasInstallForm = Object.keys(installationFormFlat).length > 0;
	let installRequestBody = hasInstallForm ? { installationForm: installationFormFlat } : undefined;

	const updateInstalledSkill = async (
		installedId: string
	): Promise<'updated' | 'not_supported'> => {
		const normalizedInstalledId = normalizeRemoteSkillId(installedId);
		if (!normalizedInstalledId) return 'not_supported';
		const remote = await requestLadcraft(
			'PATCH',
			`/v1/application/space/install/${encodeURIComponent(normalizedInstalledId)}?type=skill`,
			installRequestBody
		);
		if (remote.status >= 200 && remote.status < 300) {
			return 'updated';
		}
		if (remote.status === 404 || remote.status === 405) {
			return 'not_supported';
		}
		throw new DevServerHttpError(
			remote.status,
			extractApiErrorMessage(
				remote.data,
				`Не удалось обновить установленный экземпляр навыка (${normalizedInstalledId})`
			)
		);
	};

	const uninstallInstalledSkill = async (installedId: string): Promise<void> => {
		const normalizedInstalledId = normalizeRemoteSkillId(installedId);
		if (!normalizedInstalledId) return;
		const candidates: Array<{ method: 'DELETE' | 'POST'; endpoint: string }> = [
			{
				method: 'DELETE',
				endpoint: `/v1/application/space/install/${encodeURIComponent(normalizedInstalledId)}?type=skill`
			},
			{
				method: 'POST',
				endpoint: `/v1/application/space/uninstall/${encodeURIComponent(normalizedInstalledId)}?type=skill`
			},
			{
				method: 'DELETE',
				endpoint: `/v1/application/space/uninstall/${encodeURIComponent(normalizedInstalledId)}?type=skill`
			}
		];
		let lastErrorMessage = '';
		for (const candidate of candidates) {
			const remote = await requestLadcraft(candidate.method, candidate.endpoint);
			if (remote.status >= 200 && remote.status < 300) {
				return;
			}
			if (remote.status === 404 || remote.status === 405) {
				lastErrorMessage = extractApiErrorMessage(
					remote.data,
					`Не удалось удалить установленный экземпляр навыка (${normalizedInstalledId})`
				);
				continue;
			}
			throw new DevServerHttpError(
				remote.status,
				extractApiErrorMessage(
					remote.data,
					`Не удалось удалить установленный экземпляр навыка (${normalizedInstalledId})`
				)
			);
		}
		throw new DevServerHttpError(
			502,
			lastErrorMessage || `Не удалось удалить установленный экземпляр навыка (${normalizedInstalledId})`
		);
	};

	const fetchExistingInstalledFormValues = async (
		targetSkillId: string
	): Promise<InstallationFormByTool | null> => {
		const normalizedSkillId = normalizeRemoteSkillId(targetSkillId);
		if (!normalizedSkillId) return null;
		const remote = await requestLadcraft(
			'GET',
			`/v1/application/${encodeURIComponent(normalizedSkillId)}?type=skill&return_installed=true`
		);
		if (remote.status !== 200) return null;
		const unwrapped = asRecord(unwrapApiEnvelope(remote.data));
		if (!unwrapped) return null;
		const details: LadcraftApplicationDetails = {
			id: normalizeRemoteSkillId(unwrapped.id) || normalizedSkillId,
			title: typeof unwrapped.title === 'string' ? unwrapped.title : undefined,
			name: typeof unwrapped.name === 'string' ? unwrapped.name : undefined,
			description: typeof unwrapped.description === 'string' ? unwrapped.description : undefined,
			detailed_description:
				typeof unwrapped.detailed_description === 'string' ? unwrapped.detailed_description : null,
			skill: typeof unwrapped.skill === 'string' ? unwrapped.skill : null,
			version: typeof unwrapped.version === 'string' ? unwrapped.version : null,
			author: typeof unwrapped.author === 'string' ? unwrapped.author : null,
			license: typeof unwrapped.license === 'string' ? unwrapped.license : null,
			tags: Array.isArray(unwrapped.tags) ? unwrapped.tags.map(String) : [],
			category: typeof unwrapped.category === 'string' ? unwrapped.category : null,
			icon: typeof unwrapped.icon === 'string' ? unwrapped.icon : null,
			cover: typeof unwrapped.cover === 'string' ? unwrapped.cover : null,
			tools: Array.isArray(unwrapped.tools)
				? unwrapped.tools.filter((item): item is Record<string, unknown> => asRecord(item) != null)
				: [],
			updated_at: typeof unwrapped.updated_at === 'string' ? unwrapped.updated_at : undefined
		};
		const extracted = extractInstalledSkillInstallationFormValues(details);
		return Object.keys(extracted).length > 0 ? extracted : null;
	};

	const list = await listLadcraftAuthoredSkillsDirect();
	const createAsName = options?.createAsName?.trim() || null;
	const targetName = createAsName || payload.name;
	const existingByName = findExistingLadcraftSkillByName(list, targetName);
	const mode = options?.mode ?? 'upsert';
	let skillId = options?.skillId?.trim() || null;
	let modeUsed: 'create' | 'update' = 'create';
	const fromVersion = String(existingByName?.version ?? '').trim() || '1.0.0';

	if (mode === 'create' && existingByName) {
		throw new DevServerHttpError(409, `Навык "${targetName}" уже существует в Ladcraft.`);
	}
	if (mode === 'update' && !skillId) {
		throw new DevServerHttpError(400, 'skillId is required for update mode');
	}
	if (mode === 'upsert' && !skillId && existingByName) {
		skillId = existingByName.id;
		modeUsed = 'update';
	}
	if (mode === 'update') {
		modeUsed = 'update';
	}

		const ladcraftPayload = await convertBuilderLocalSkillToLadcraftPayload(payload, {
			skillNameOverride: createAsName,
			resolveDefaultCategory: resolveDefaultLadcraftCategory
		});
	const hasUserEnvironmentFields = ladcraftPayload.tools.some((tool) => {
		const env = asRecord((tool as Record<string, unknown>).environment);
		const userEnv = asRecord(env?.user);
		return userEnv != null && Object.keys(userEnv).length > 0;
	});
	if (modeUsed === 'update' && skillId) {
		const remote = await requestLadcraft(
			'PATCH',
			`/v1/application/skill/${encodeURIComponent(skillId)}`,
			{
				title: ladcraftPayload.name,
				description: ladcraftPayload.description,
				detailed_description: ladcraftPayload.skill,
				category: ladcraftPayload.category,
				icon: ladcraftPayload.icon,
				cover: ladcraftPayload.cover,
				tags: ladcraftPayload.tags,
				tools: ladcraftPayload.tools
			}
		);
		if (remote.status < 200 || remote.status >= 300) {
			throw new DevServerHttpError(
				remote.status,
				extractApiErrorMessage(remote.data, 'Ladcraft не принял обновление навыка')
			);
		}
	} else {
		const remote = await requestLadcraft('POST', '/v1/application/skill', ladcraftPayload);
		if (remote.status < 200 || remote.status >= 300) {
			throw new DevServerHttpError(
				remote.status,
				extractApiErrorMessage(remote.data, 'Ladcraft не принял новый навык')
			);
		}
		const created = asRecord(unwrapApiEnvelope(remote.data));
		skillId = normalizeRemoteSkillId(created?.id);
		if (!skillId) {
			throw new DevServerHttpError(502, 'Ladcraft не вернул id созданного навыка');
		}
		modeUsed = 'create';
	}

	const refreshedList = await listLadcraftAuthoredSkillsDirect();
	const installedIds = Array.from(
		new Set(
			refreshedList
				.filter((item) => item.id === skillId)
				.map((item) => normalizeRemoteSkillId(item.installed?.id))
				.filter((value): value is string => value.length > 0)
		)
	);
	if (installedIds.length > 0) {
		const firstUpdateStatus = await updateInstalledSkill(installedIds[0]);
		for (const installedId of installedIds.slice(1)) {
			await updateInstalledSkill(installedId);
		}
		// После публикации новой версии делаем reinstall, чтобы гарантированно подтянуть
		// runtime-ограничения (включая resources.network.hosts) для установленного экземпляра.
		if (!hasInstallForm && hasUserEnvironmentFields) {
			const extracted = await fetchExistingInstalledFormValues(skillId);
			if (extracted) {
				installationFormByTool = extracted;
				installationFormFlat = flattenInstallationFormByTool(installationFormByTool);
				hasInstallForm = true;
				installRequestBody = { installationForm: installationFormFlat };
			}
		}
		if (!hasInstallForm && hasUserEnvironmentFields && firstUpdateStatus !== 'updated') {
			// PATCH install не поддержан, а восстановить installationForm не удалось.
			// В этом случае избегаем reinstall, чтобы не потерять user env.
			return {
				applicationId: skillId,
				modeUsed,
				installedApplicationId: installedIds[0],
				installSyncSkipped: true,
				fromVersion,
				autoInstallStatus: 'skipped'
			};
		}
		for (const installedId of installedIds) {
			await uninstallInstalledSkill(installedId);
		}
	}

	const installRemote = await requestLadcraft(
		'POST',
		`/v1/application/space/install/${encodeURIComponent(skillId)}?type=skill`,
		installRequestBody
	);
	if (installRemote.status < 200 || installRemote.status >= 300) {
		throw new DevServerHttpError(
			installRemote.status,
			extractApiErrorMessage(installRemote.data, 'Ladcraft не установил навык в пространство')
		);
	}
	const installedPayload = asRecord(unwrapApiEnvelope(installRemote.data));
	const installedApplicationId = normalizeRemoteSkillId(installedPayload?.installed_application_id);

	return {
		applicationId: skillId,
		modeUsed,
		installedApplicationId,
		fromVersion,
		autoInstallStatus: 'installed'
	};
}

async function buildDeployLocalDryRun(
	payload: LocalSkillPayload,
	options: {
		mode: 'create' | 'update' | 'upsert';
		skillId?: string | null;
		createAsName?: string | null;
	}
): Promise<DeployDryRunResult> {
	const list = await listLadcraftAuthoredSkillsDirect();
	const targetName = options.createAsName?.trim() || payload.name;
	const existingByName = findExistingLadcraftSkillByName(list, targetName);
	const currentVersion = String(existingByName?.version ?? '').trim() || '1.0.0';
	const requestedId = normalizeRemoteSkillId(options.skillId ?? '');
	const applicationId = requestedId || normalizeRemoteSkillId(existingByName?.id) || null;
	const targetAction =
		options.mode === 'create' || options.mode === 'update'
			? options.mode
			: applicationId
				? 'update'
				: 'create';
	let remoteDetails: LadcraftApplicationDetails | null = null;
	if (applicationId) {
		try {
			remoteDetails = await getLadcraftSkillDetailsDirect(applicationId);
		} catch {
			remoteDetails = null;
		}
	}
	const validationReport = buildLocalSkillValidationReport(payload);
	const diffSummary = buildDeployDiffSummary(payload, remoteDetails);
	const riskSummary: string[] = [];
	if (targetAction === 'update') {
		riskSummary.push('При неподдерживаемом PATCH установки возможен fallback через uninstall/install.');
	}
	if (payload.mcp_spec) {
		riskSummary.push('Проверьте environment.user и installationForm перед подтверждением deploy.');
	}
	return {
		currentVersion,
		targetAction,
		applicationId,
		validation: {
			errors: validationReport.errors.map((issue) => issue.message),
			warnings: validationReport.warnings.map((issue) => issue.message)
		},
		validationReport,
		riskSummary,
		diffSummary
	};
}

app.post('/api/remote/publish', async (req, res) => {
	try {
		const parsed = remotePublishSchema.parse(req.body);
		const instForm = parsed.installationForm;
		if (instForm && Object.keys(instForm).length > 0) {
			await saveInstallationFormDraft(parsed.skillPayload.name, instForm);
		}
		const published = await publishLocalSkillToLadcraft(parsed.skillPayload, {
			mode: parsed.mode,
			skillId: parsed.skillId ?? null,
			installationForm:
				instForm && Object.keys(instForm).length > 0 ? instForm : undefined
		});
		res.json({ ok: true, ...published });
	} catch (err) {
		sendHttpError(res, err, 'Failed to send skill to Ladcraft', 400);
	}
});

app.post('/api/remote/deploy-local/dry-run', async (req, res) => {
	try {
		const parsed = remoteDeployLocalSchema.parse(req.body);
		const deployPayload = parsed.skillPayload
			? (parsed.skillPayload as LocalSkillPayload)
			: await (async () => {
					const entry = await findLocalSkillEntry(parsed.skillName);
					if (!entry) {
						throw new DevServerHttpError(404, `Local skill "${parsed.skillName}" not found`);
					}
					return convertFolderToPayloadJson(entry.filePath);
				})();
		const preflight = await buildDeployLocalDryRun(deployPayload, {
			mode: parsed.mode,
			skillId: parsed.skillId ?? null,
			createAsName: parsed.createAsName ?? null
		});
		await appendDeployHistory({
			skillName: parsed.skillName,
			mode: parsed.mode,
			fromVersion: preflight.currentVersion,
			applicationId: preflight.applicationId,
			installedApplicationId: null,
			autoInstallStatus: null,
			status: 'dry_run',
			error: null
		});
		res.json({ ok: true, preflight });
	} catch (err) {
		sendHttpError(res, err, 'Failed to run deploy dry-run', 400);
	}
});

app.get('/api/remote/deploy-local/history', async (req, res) => {
	try {
		const skillName = typeof req.query.skillName === 'string' ? req.query.skillName.trim() : '';
		const limitRaw = typeof req.query.limit === 'string' ? Number(req.query.limit) : 20;
		const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(100, Math.trunc(limitRaw))) : 20;
		const history = await loadDeployHistory();
		const filtered = skillName
			? history.filter((item) => item.skillName === skillName).slice(0, limit)
			: history.slice(0, limit);
		res.json({ ok: true, history: filtered });
	} catch (err) {
		sendHttpError(res, err, 'Failed to load deploy history', 400);
	}
});

app.post('/api/remote/deploy-local/replay', async (req, res) => {
	try {
		const historyId = Number((req.body as { historyId?: unknown })?.historyId);
		if (!Number.isFinite(historyId) || historyId <= 0) {
			throw new DevServerHttpError(400, 'historyId is required');
		}
		const history = await loadDeployHistory();
		const item = history.find((entry) => entry.id === historyId);
		if (!item) {
			throw new DevServerHttpError(404, 'Deploy history entry not found');
		}
		const entry = await findLocalSkillEntry(item.skillName);
		if (!entry) {
			throw new DevServerHttpError(404, `Local skill "${item.skillName}" not found`);
		}
		const deployPayload = await convertFolderToPayloadJson(entry.filePath);
		const validationReport = buildLocalSkillValidationReport(deployPayload);
		if (validationReport.isBlocking) {
			res.status(400).json({
				ok: false,
				error: 'Skill validation failed',
				validationReport,
				blocking: true
			});
			return;
		}
		const published = await publishLocalSkillToLadcraft(deployPayload, {
			mode: item.mode,
			skillId: item.applicationId
		});
		const recorded = await appendDeployHistory({
			skillName: item.skillName,
			mode: item.mode,
			fromVersion: published.fromVersion ?? item.fromVersion,
			applicationId: published.applicationId,
			installedApplicationId: published.installedApplicationId ?? null,
			autoInstallStatus: published.autoInstallStatus ?? null,
			status: 'success',
			error: null
		});
		res.json({ ok: true, replayedFrom: item.id, historyId: recorded.id, ...published });
	} catch (err) {
		sendHttpError(res, err, 'Failed to replay deploy', 400);
	}
});

app.post('/api/remote/deploy-local/post-check', async (req, res) => {
	try {
		const skillName = String((req.body as { skillName?: unknown })?.skillName ?? '').trim();
		if (!skillName) {
			throw new DevServerHttpError(400, 'skillName is required');
		}
		const entry = await findLocalSkillEntry(skillName);
		if (!entry) {
			throw new DevServerHttpError(404, `Local skill "${skillName}" not found`);
		}
		const payload = await convertFolderToPayloadJson(entry.filePath);
		const checks: Array<{ id: string; status: 'ok' | 'warn' | 'fail'; message: string }> = [];
		const firstScript = payload.scripts[0];
		if (firstScript) {
			try {
				await executeLocalScript({
					code: firstScript.code,
					input: {},
					skillName: payload.name,
					scriptName: firstScript.name,
					env: process.env,
					skillStorage: skillStorageManager.forSkill(payload.name),
					vfs,
					oauthToken: null,
					telegramChatId: null
				});
				checks.push({
					id: 'smoke_tool',
					status: 'ok',
					message: `Smoke test скрипта ${firstScript.name} выполнен`
				});
			} catch (err) {
				checks.push({
					id: 'smoke_tool',
					status: 'fail',
					message: err instanceof Error ? err.message : 'Ошибка smoke test'
				});
			}
		} else {
			checks.push({
				id: 'smoke_tool',
				status: 'warn',
				message: 'У навыка нет scripts для smoke test'
			});
		}
		const mcp = asRecord(payload.mcp_spec);
		let envFieldsCount = 0;
		if (mcp && Array.isArray(mcp.tools)) {
			for (const tool of mcp.tools) {
				const toolRecord = asRecord(tool);
				const envRecord = asRecord(toolRecord?.environment);
				const userRecord = asRecord(envRecord?.user);
				if (userRecord) {
					envFieldsCount += Object.keys(userRecord).length;
				}
			}
		}
		checks.push({
			id: 'installation_form',
			status: envFieldsCount > 0 ? 'ok' : 'warn',
			message:
				envFieldsCount > 0
					? `Найдено ${envFieldsCount} полей installationForm`
					: 'Поля installationForm не обнаружены'
		});
		const existingByName = findExistingLadcraftSkillByName(
			await listLadcraftAuthoredSkillsDirect(),
			payload.name
		);
		checks.push({
			id: 'conflict_check',
			status: existingByName ? 'warn' : 'ok',
			message: existingByName
				? `В Ladcraft найден навык с таким именем: ${getApplicationDisplayName(existingByName)}`
				: 'Конфликт имени не найден'
		});
		const summary = {
			ok: checks.filter((item) => item.status === 'ok').length,
			warn: checks.filter((item) => item.status === 'warn').length,
			fail: checks.filter((item) => item.status === 'fail').length
		};
		res.json({ ok: true, checks, summary });
	} catch (err) {
		sendHttpError(res, err, 'Failed to run post-deploy checks', 400);
	}
});

app.post('/api/remote/deploy-local', async (req, res) => {
	let parsed: z.infer<typeof remoteDeployLocalSchema> | null = null;
	try {
		parsed = remoteDeployLocalSchema.parse(req.body);
		const deployPayload = parsed.skillPayload
			? (parsed.skillPayload as LocalSkillPayload)
			: await (async () => {
					const entry = await findLocalSkillEntry(parsed.skillName);
					if (!entry) {
						throw new DevServerHttpError(404, `Local skill "${parsed.skillName}" not found`);
					}
					return convertFolderToPayloadJson(entry.filePath);
				})();
		const validationReport = buildLocalSkillValidationReport(deployPayload);
		if (validationReport.isBlocking) {
			res.status(400).json({
				ok: false,
				error: 'Skill validation failed',
				validationReport,
				blocking: true
			});
			return;
		}
		const targetName = parsed.createAsName?.trim() || deployPayload.name;
		if (parsed.mode === 'create') {
			const existingByName = findExistingLadcraftSkillByName(
				await listLadcraftAuthoredSkillsDirect(),
				targetName
			);
			if (existingByName) {
				await appendDeployHistory({
					skillName: parsed.skillName,
					mode: parsed.mode,
					fromVersion: String(existingByName.version ?? '').trim() || '1.0.0',
					applicationId: existingByName.id,
					installedApplicationId: null,
					autoInstallStatus: null,
					status: 'conflict',
					error: `Навык "${targetName}" уже существует в Ladcraft.`
				});
				res.status(200).json({
					ok: false,
					conflict: true,
					existing: {
						id: existingByName.id,
						name: getApplicationDisplayName(existingByName) || targetName
					}
				});
				return;
			}
		}
		const instFormDeploy = parsed.installationForm;
		if (instFormDeploy && Object.keys(instFormDeploy).length > 0) {
			await saveInstallationFormDraft(parsed.skillName, instFormDeploy);
		}
		const published = await publishLocalSkillToLadcraft(deployPayload, {
			mode: parsed.mode,
			skillId: parsed.skillId ?? null,
			createAsName: parsed.createAsName ?? null,
			installationForm:
				instFormDeploy && Object.keys(instFormDeploy).length > 0
					? instFormDeploy
					: undefined
		});
		await appendDeployHistory({
			skillName: parsed.skillName,
			mode: parsed.mode,
			fromVersion: published.fromVersion ?? '1.0.0',
			applicationId: published.applicationId,
			installedApplicationId: published.installedApplicationId ?? null,
			autoInstallStatus: published.autoInstallStatus ?? null,
			status: 'success',
			error: null
		});
		if (!parsed.createAsName || parsed.createAsName.trim() === deployPayload.name.trim()) {
			await linkLocalSkillToRemote(parsed.skillName, published.applicationId);
		}
		compatibilityAuditManager.schedule();
		res.json({
			ok: true,
			modeUsed: published.modeUsed,
			applicationId: published.applicationId,
			fromVersion: published.fromVersion ?? null,
			installSyncSkipped: Boolean(published.installSyncSkipped),
			installSyncWarning: published.installSyncSkipped
				? 'Установка в space не переустановлена, чтобы сохранить существующий environment.user. Для смены значений передайте installationForm.'
				: null
		});
	} catch (err) {
		if (err instanceof DevServerHttpError && err.status === 409 && parsed) {
			const existingByName = findExistingLadcraftSkillByName(
				await listLadcraftAuthoredSkillsDirect().catch(() => []),
				parsed.createAsName?.trim() || parsed.skillName
			);
			res.status(200).json({
				ok: false,
				conflict: true,
				existing: existingByName
					? {
							id: existingByName.id,
							name:
								getApplicationDisplayName(existingByName) ||
								parsed.createAsName?.trim() ||
								parsed.skillName
						}
					: { id: '', name: parsed.createAsName?.trim() || parsed.skillName }
			});
			await appendDeployHistory({
				skillName: parsed.skillName,
				mode: parsed.mode,
				fromVersion: '1.0.0',
				applicationId: existingByName?.id ?? null,
				installedApplicationId: null,
				autoInstallStatus: null,
				status: 'conflict',
				error: err.message
			});
			return;
		}
		if (parsed) {
			await appendDeployHistory({
				skillName: parsed.skillName,
				mode: parsed.mode,
				fromVersion: '1.0.0',
				applicationId: parsed.skillId ?? null,
				installedApplicationId: null,
				autoInstallStatus: null,
				status: 'failed',
				error: err instanceof Error ? err.message : 'Failed to deploy local skill'
			});
		}
		sendHttpError(res, err, 'Failed to deploy local skill', 400);
	}
});

const isProduction = process.env.NODE_ENV === 'production';

if (isProduction && existsSync(config.webUiDistPath)) {
	app.use(express.static(config.webUiDistPath));
	app.get('*', (_req, res) => {
		res.sendFile(path.join(config.webUiDistPath, 'index.html'));
	});
}

async function bootstrap(): Promise<void> {
	await Promise.all([
		mkdir(config.vfsRoot, { recursive: true }),
		ensureSkillsDir(),
		ensurePrototypeSkillsDir()
	]);
	compatibilityAuditManager.schedule();
	console.log(`[dev-server] localSkillsDir: ${localSkillsDir}`);
	console.log(`[dev-server] prototypeSkillsDir: ${prototypeSkillsDir}`);
	app.listen(config.devServerPort, () => {
		console.log(`[dev-server] API listening on http://localhost:${config.devServerPort}`);
		if (!isProduction) {
			console.log(`[dev-server] web-ui (vite) expected on http://localhost:${config.webUiPort}`);
		}
	});
}

bootstrap().catch((err) => {
	console.error('[dev-server] failed to start', err);
	process.exit(1);
});
