import { existsSync, readFileSync } from 'node:fs';
import { mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { isPlaceholderToken, normalizeConfiguredToken } from './api-payload.js';

const currentFilePath = fileURLToPath(import.meta.url);
const srcDir = dirname(currentFilePath);
const devServerRoot = join(srcDir, '..');
const cursorMcpRoot = join(devServerRoot, '..');

dotenv.config({ path: join(devServerRoot, '.env') });

function parseIntWithDefault(value: string | undefined, fallback: number): number {
	const parsed = Number(value);
	return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function normalizeLadcraftEnv(value: string | undefined): 'dev' | 'prod' {
	return value?.trim().toLowerCase() === 'prod' ? 'prod' : 'dev';
}

function resolvePathOverride(value: string | undefined, fallback: string): string {
	const trimmed = typeof value === 'string' ? value.trim() : '';
	return trimmed ? resolve(trimmed) : fallback;
}

const mcpConfigPath = join(cursorMcpRoot, '.cursor', 'mcp.json');

function readMcpConfig(): {
	url: string | null;
	token: string | null;
	tokenIsPlaceholder: boolean;
} {
	if (!existsSync(mcpConfigPath)) {
		return { url: null, token: null, tokenIsPlaceholder: false };
	}
	try {
		const content = readFileSync(mcpConfigPath, 'utf-8');
		const parsed = JSON.parse(content) as {
			mcpServers?: Record<string, { url?: string }>;
		};
		const url = parsed.mcpServers?.['skilled-agent']?.url;
		const urlStr = typeof url === 'string' ? url : null;
		if (!urlStr) {
			return { url: null, token: null, tokenIsPlaceholder: false };
		}
		const u = new URL(urlStr);
		const token = u.searchParams.get('token');
		const tokenStr = token && token.trim() ? token.trim() : null;
		return {
			url: urlStr,
			token: normalizeConfiguredToken(tokenStr) || null,
			tokenIsPlaceholder: isPlaceholderToken(tokenStr)
		};
	} catch (err) {
		console.error('[config] Error reading mcp.json:', err);
		return { url: null, token: null, tokenIsPlaceholder: false };
	}
}

function inferSkilledAgentUrl(mcpUrl: string | null): string | null {
	if (!mcpUrl) return null;
	try {
		const url = new URL(mcpUrl);
		if (url.port === '3001') {
			return `${url.protocol}//${url.hostname}:3000`;
		}
		return `${url.protocol}//${url.host}`;
	} catch {
		return null;
	}
}

/** Читаем .cursor/mcp.json один раз: url и token (из параметра token в url) */
const mcpConfig = readMcpConfig();
const inferredSkilledAgentUrl = inferSkilledAgentUrl(mcpConfig.url);

const devDataDir = join(devServerRoot, '.dev-data');
mkdirSync(devDataDir, { recursive: true });

type SourceLabel = 'env:prototype' | 'mcp' | 'env:shared' | 'default' | 'none';

function pickFirstWithSource(
	options: Array<{ value: string | null | undefined; source: SourceLabel }>
): {
	value: string;
	source: SourceLabel;
} {
	for (const option of options) {
		const normalized = normalizeConfiguredToken(option.value);
		if (normalized) {
			return { value: normalized, source: option.source };
		}
	}
	return { value: '', source: 'none' };
}

const prototypeUrlResolved = pickFirstWithSource([
	{ value: process.env.PROTOTYPE_SKILLED_AGENT_URL, source: 'env:prototype' },
	{ value: inferredSkilledAgentUrl, source: 'mcp' },
	{ value: process.env.SKILLED_AGENT_URL, source: 'env:shared' },
	{ value: 'http://localhost:3000', source: 'default' }
]);

const prototypeTokenResolved = pickFirstWithSource([
	{ value: process.env.PROTOTYPE_SKILLED_AGENT_TOKEN, source: 'env:prototype' },
	{ value: mcpConfig.token, source: 'mcp' },
	{ value: process.env.SKILLED_AGENT_TOKEN, source: 'env:shared' }
]);

const prototypeTokenWarning =
	prototypeTokenResolved.source === 'none' && mcpConfig.tokenIsPlaceholder
		? 'В .cursor/mcp.json указан token-заполнитель REPLACE_WITH_TOKEN. Для загрузки навыков прототипа нужен реальный token или архив, скачанный из приложения.'
		: null;

const ladcraftEnv = normalizeLadcraftEnv(process.env.LADCRAFT_ENV);
const ladcraftEnvironments = {
	dev: {
		apiBaseUrl: process.env.LADCRAFT_API_BASE_URL_DEV || 'https://api.dev.e-ai.ladcloud.ru',
		reauthUrl:
			process.env.LADCRAFT_APP_BASE_URL_DEV ||
			process.env.LADCRAFT_REAUTH_URL ||
			'https://app.dev.e-ai.ladcloud.ru/'
	},
	prod: {
		apiBaseUrl: process.env.LADCRAFT_API_BASE_URL_PROD || 'https://api.ladcraft.ru',
		reauthUrl: process.env.LADCRAFT_APP_BASE_URL_PROD || 'https://app.ladcraft.ru/'
	}
} as const;

export const config = {
	devServerPort: parseIntWithDefault(process.env.DEV_SERVER_PORT, 4321),
	webUiPort: parseIntWithDefault(process.env.WEB_UI_PORT, 5174),
	skilledAgentUrl:
		process.env.SKILLED_AGENT_URL || inferredSkilledAgentUrl || 'http://localhost:3000',
	skilledAgentToken: normalizeConfiguredToken(process.env.SKILLED_AGENT_TOKEN),
	prototypeSkilledAgentUrl: prototypeUrlResolved.value || 'http://localhost:3000',
	prototypeSkilledAgentUrlSource: prototypeUrlResolved.source,
	prototypeSkilledAgentToken: prototypeTokenResolved.value,
	prototypeSkilledAgentTokenSource: prototypeTokenResolved.source,
	prototypeTokenWarning,
	ladcraftEnv,
	ladcraftEnvironments,
	ladcraftApiBaseUrl: ladcraftEnvironments[ladcraftEnv].apiBaseUrl,
	ladcraftReauthUrl: ladcraftEnvironments[ladcraftEnv].reauthUrl,
	ladcraftTokenRefreshHint:
		process.env.LADCRAFT_TOKEN_REFRESH_HINT ||
		'Токен Ladcraft истек. Войдите через email/password или обновите токен вручную.',
	envFilePath: join(devServerRoot, '.env'),
	vfsRoot: join(devDataDir, 'vfs'),
	skillStorageFile: join(devDataDir, 'skillStorage.json'),
	webUiDistPath: join(devServerRoot, 'web-ui', 'dist'),
		/** Папка cursor_ladcraft/skills — формат папок (SKILL.md, scripts/, widgets/). */
		localSkillsDir: resolvePathOverride(process.env.LOCAL_SKILLS_DIR, join(cursorMcpRoot, 'skills')),
		/** Отдельная папка для навыков прототипа, загруженных с prototype API. */
		prototypeSkillsDir: resolvePathOverride(
			process.env.PROTOTYPE_SKILLS_DIR,
			join(cursorMcpRoot, 'skills_prototype')
		),
	mcpUrl: mcpConfig.url
};
