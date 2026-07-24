import { existsSync } from 'node:fs';
import { cp, mkdir, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import yaml from 'js-yaml';
import { readSkillFromFolder, type LocalSkillPayload } from './skill-folder-reader.js';
import {
	normalizeLocalSkillPayloadForStorage
} from './skill-builder.js';
import { sanitizeSkillFolderName } from './skill-identity.js';

const SKILL_FILE_NAME = 'SKILL.md';
const DEPLOY_TEMP_FILE = '.payload.deploy.json';
const SKILL_BACKUPS_DIR = '.skill-backups';

function scriptToFrontmatter(script: {
	name: string;
	description?: string;
	input_schema?: Record<string, unknown>;
	output_schema?: Record<string, unknown> | null;
	script_file?: string | null;
	auth?: Record<string, unknown> | null;
	order?: number;
	resources?: {
		cpu?: number;
		gpu?: number;
		memory?: number;
		timeout?: number;
		network?: { hosts?: string[] };
	};
}): string {
	const data: Record<string, unknown> = { name: script.name };
	if ('description' in script) data.description = script.description ?? '';
	if ('script_file' in script) data.scriptFile = script.script_file ?? null;
	if ('input_schema' in script || 'output_schema' in script) {
		data.schemas = {
			input: script.input_schema ?? null,
			output: script.output_schema ?? null
		};
	}
	if ('auth' in script) data.auth = script.auth ?? null;
	if (typeof script.order === 'number') data.order = script.order;
	if (script.resources && Object.keys(script.resources).length > 0) data.resources = script.resources;
	return '---\n' + yaml.dump(data, { lineWidth: -1 }) + '---\n\n';
}

/**
 * Формирует frontmatter виджета и при необходимости записывает inline-скрипты в scripts/.
 * Виджет импортирует скрипты через scriptRefs, а не дублирует код в .MD.
 */
async function writeWidgetAndScriptRefs(
	widget: Record<string, unknown>,
	widgetsDir: string,
	scriptsDir: string
): Promise<string> {
	const data: Record<string, unknown> = {
		name: widget.name ?? 'widget',
		description: widget.description ?? ''
	};
	const schema = widget.schema as Record<string, unknown> | undefined;
	if (schema && typeof schema === 'object' && Object.keys(schema).length > 0) data.schema = schema;

	const scripts = widget.scripts as Array<Record<string, unknown>> | undefined;
	const inlineContents: string[] = [];
	const urlOnlyScripts: Array<Record<string, unknown>> = [];

	if (Array.isArray(scripts)) {
		for (const s of scripts) {
			if (s?.type === 'inline' && typeof s.content === 'string') {
				inlineContents.push(s.content);
			} else if (s?.type === 'url' && typeof s.url === 'string') {
				urlOnlyScripts.push({ type: 'url', url: s.url });
			}
		}
	}

	const baseName = String(widget.name || 'widget').replace(/[^a-z0-9_-]/gi, '_');
	if (inlineContents.length > 0) {
		const widgetJsName = `${baseName}.widget.js`;
		const widgetJsPath = join(scriptsDir, widgetJsName);
		await writeFile(widgetJsPath, inlineContents.join('\n\n'), 'utf-8');
		data.scriptRefs = [widgetJsName];
	}
	if (urlOnlyScripts.length > 0) {
		data.scripts = urlOnlyScripts;
	}

	const external_libraries = widget.external_libraries as Array<Record<string, unknown>> | undefined;
	if (Array.isArray(external_libraries) && external_libraries.length > 0) data.external_libraries = external_libraries;
	return '---\n' + yaml.dump(data, { lineWidth: -1 }) + '---\n\n';
}

export async function writeSkillToFolder(folderPath: string, payload: LocalSkillPayload): Promise<void> {
	await mkdir(folderPath, { recursive: true });

	// Используем yaml.dump для правильного экранирования спецсимволов YAML (двоеточия, кавычки и т.д.)
	const frontmatterData: Record<string, unknown> = {
		name: payload.name,
		description: payload.description
	};
	if (payload.mcp_spec && Object.keys(payload.mcp_spec).length > 0) {
		frontmatterData.mcp_spec = payload.mcp_spec;
	}
	const frontmatter = '---\n' + yaml.dump(frontmatterData, { lineWidth: -1 }) + '---\n\n';
	const skillMd = frontmatter + (payload.body || '') + '\n';
	await writeFile(join(folderPath, SKILL_FILE_NAME), skillMd, 'utf-8');

	const scriptsDir = join(folderPath, 'scripts');
	await mkdir(scriptsDir, { recursive: true });
	for (const script of payload.scripts ?? []) {
		const baseName = script.name.replace(/[^a-z0-9_-]/gi, '_');
		const mdPath = join(scriptsDir, `${baseName}.meta.md`);
		const jsPath = join(scriptsDir, `${baseName}.js`);
		const front = scriptToFrontmatter({
			name: script.name,
			description: script.description,
			input_schema: script.input_schema,
			output_schema: script.output_schema ?? null,
			script_file: script.script_file ?? `${baseName}.js`,
			auth: script.auth ?? null,
			order: script.order,
			resources: script.resources
		});
		await writeFile(mdPath, front, 'utf-8');
		await writeFile(jsPath, script.code || '', 'utf-8');
	}

	const widgetsDir = join(folderPath, 'widgets');
	await mkdir(widgetsDir, { recursive: true });
	for (const widget of payload.widgets ?? []) {
		const name = (widget.name as string) || 'widget';
		const baseName = name.replace(/[^a-z0-9_-]/gi, '_');
		const mdPath = join(widgetsDir, `${baseName}.MD`);
		const front = await writeWidgetAndScriptRefs(widget, widgetsDir, scriptsDir);
		const template = (widget.template as string) || '';
		await writeFile(mdPath, front + template, 'utf-8');
	}
}

function inferSkillsRoot(folderPath: string): string {
	const parentPath = dirname(folderPath);
	const parentName = basename(parentPath);
	if (parentName.startsWith('.')) {
		return dirname(parentPath);
	}
	return parentPath;
}

async function createSkillBackup(folderPath: string, skillName: string): Promise<string> {
	const skillsRoot = inferSkillsRoot(folderPath);
	const backupsRoot = join(
		skillsRoot,
		SKILL_BACKUPS_DIR,
		sanitizeSkillFolderName(skillName) || 'skill'
	);
	const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
	const backupPath = join(backupsRoot, timestamp);
	await mkdir(backupsRoot, { recursive: true });
	await cp(folderPath, backupPath, { recursive: true });
	return backupPath;
}

async function restoreSkillBackup(folderPath: string, backupPath: string): Promise<void> {
	await rm(folderPath, { recursive: true, force: true });
	await cp(backupPath, folderPath, { recursive: true });
}

export async function readCanonicalSkillFromFolder(folderPath: string): Promise<{
	payload: LocalSkillPayload;
	changed: boolean;
	backupPath: string | null;
}> {
	const payload = await readSkillFromFolder(folderPath);
	const normalized = normalizeLocalSkillPayloadForStorage(payload);
	if (!normalized.changed) {
		return {
			payload,
			changed: false,
			backupPath: null
		};
	}
	let backupPath: string | null = null;
	if (existsSync(folderPath)) {
		backupPath = await createSkillBackup(folderPath, normalized.payload.name || basename(folderPath));
	}
	try {
		await writeSkillToFolder(folderPath, normalized.payload);
		return {
			payload: normalized.payload,
			changed: true,
			backupPath
		};
	} catch (error) {
		if (backupPath) {
			try {
				await restoreSkillBackup(folderPath, backupPath);
			} catch (restoreError) {
				const message = error instanceof Error ? error.message : String(error);
				const restoreMessage =
					restoreError instanceof Error ? restoreError.message : String(restoreError);
				throw new Error(
					`Не удалось нормализовать навык: ${message}. Восстановление из backup не удалось: ${restoreMessage}. Backup: ${backupPath}`
				);
			}
		}
		const message = error instanceof Error ? error.message : String(error);
		throw new Error(
			backupPath
				? `Не удалось нормализовать навык: ${message}. Локальная версия восстановлена из backup: ${backupPath}`
				: `Не удалось нормализовать навык: ${message}`
		);
	}
}

/**
 * Конвертирует папку навыка в canonical payload.
 * При необходимости автоматически нормализует legacy scripts и сохраняет backup.
 */
export async function convertFolderToPayloadJson(folderPath: string): Promise<LocalSkillPayload> {
	const result = await readCanonicalSkillFromFolder(folderPath);
	return result.payload;
}

/**
 * Создаёт временный .payload.json в папке навыка для деплоя. После отправки файл нужно удалить.
 */
export async function createTempPayloadJson(folderPath: string): Promise<{ path: string; payload: LocalSkillPayload }> {
	const payload = await convertFolderToPayloadJson(folderPath);
	const tempPath = join(folderPath, DEPLOY_TEMP_FILE);
	await writeFile(tempPath, JSON.stringify(payload, null, 2), 'utf-8');
	return { path: tempPath, payload };
}

export async function removeTempPayloadJson(folderPath: string): Promise<void> {
	const tempPath = join(folderPath, DEPLOY_TEMP_FILE);
	await rm(tempPath, { force: true });
}
