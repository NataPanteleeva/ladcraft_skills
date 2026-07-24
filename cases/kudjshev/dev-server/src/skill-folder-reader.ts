import { readdir, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import matter from 'gray-matter';

export type LocalSkillScript = {
	name: string;
	description?: string;
	input_schema?: Record<string, unknown>;
	output_schema?: Record<string, unknown> | null;
	script_file?: string | null;
	code: string;
	auth?: Record<string, unknown> | null;
	order?: number;
	resources?: {
		cpu?: number;
		gpu?: number;
		memory?: number;
		timeout?: number;
		network?: { hosts?: string[] };
	};
};

export type LocalSkillPayload = {
	name: string;
	description: string;
	body: string;
	scripts: LocalSkillScript[];
	widgets: Array<Record<string, unknown>>;
	mcp_spec?: Record<string, unknown> | null;
};

const SKILL_FILE_NAMES = ['SKILL.md', 'SKILL.MD', 'skill.md'];

function parseSchema(value: unknown): Record<string, unknown> | null {
	if (value != null && typeof value === 'object' && !Array.isArray(value)) {
		return value as Record<string, unknown>;
	}
	return null;
}

function parseScriptResources(
	value: unknown
):
	| {
			cpu?: number;
			gpu?: number;
			memory?: number;
			timeout?: number;
			network?: { hosts?: string[] };
	  }
	| undefined {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
	const raw = value as Record<string, unknown>;
	const out: {
		cpu?: number;
		gpu?: number;
		memory?: number;
		timeout?: number;
		network?: { hosts?: string[] };
	} = {};
	const toFiniteNumber = (x: unknown): number | undefined => {
		if (typeof x !== 'number' || !Number.isFinite(x)) return undefined;
		return x;
	};
	const cpu = toFiniteNumber(raw.cpu);
	if (cpu !== undefined) out.cpu = cpu;
	const gpu = toFiniteNumber(raw.gpu);
	if (gpu !== undefined) out.gpu = gpu;
	const memory = toFiniteNumber(raw.memory);
	if (memory !== undefined) out.memory = memory;
	const timeout = toFiniteNumber(raw.timeout);
	if (timeout !== undefined) out.timeout = timeout;
	const network = raw.network;
	if (network && typeof network === 'object' && !Array.isArray(network)) {
		const hostsRaw = (network as Record<string, unknown>).hosts;
		if (Array.isArray(hostsRaw)) {
			const hosts = hostsRaw
				.filter((h): h is string => typeof h === 'string')
				.map((h) => h.trim())
				.filter(Boolean);
			out.network = { hosts };
		}
	}
	return Object.keys(out).length > 0 ? out : undefined;
}

async function readSkillMd(folderPath: string): Promise<{
	name: string;
	description: string;
	body: string;
	mcp_spec: Record<string, unknown> | null;
}> {
	const folderName = folderPath.split(/[/\\]/).pop() || folderPath;
	for (const fileName of SKILL_FILE_NAMES) {
		const filePath = join(folderPath, fileName);
		try {
			const raw = await readFile(filePath, 'utf-8');
			const parsed = matter(raw);
			const data = parsed.data as Record<string, unknown>;
			const name = typeof data.name === 'string' ? data.name.trim() : '';
			const description = typeof data.description === 'string' ? data.description.trim() : '';
			const body = typeof parsed.content === 'string' ? parsed.content.trim() : '';
			const mcpSpec = parseSchema(data.mcp_spec);
			if (name) {
				return { name, description, body, mcp_spec: mcpSpec };
			} else {
				console.warn(`[skill-folder-reader] ${folderName}: SKILL file ${fileName} found but name is empty or invalid`, { data });
			}
		} catch (err) {
			const enoent =
				typeof err === 'object' &&
				err != null &&
				'code' in err &&
				(err as { code?: unknown }).code === 'ENOENT';
			if (!enoent) {
				console.warn(
					`[skill-folder-reader] ${folderName}: Error reading ${fileName}:`,
					err instanceof Error ? err.message : String(err)
				);
			}
			continue;
		}
	}
	throw new Error(`SKILL.md not found or invalid in ${folderPath}`);
}

async function readScripts(folderPath: string): Promise<LocalSkillScript[]> {
	const scriptsDir = join(folderPath, 'scripts');
	let entries: string[];
	try {
		entries = await readdir(scriptsDir);
	} catch {
		return [];
	}

	const scriptMdFiles = entries.filter((e) => {
		const lower = e.toLowerCase();
		return lower.endsWith('.meta.md') || lower.endsWith('.script.md');
	});
	const result: LocalSkillScript[] = [];

	for (const mdFile of scriptMdFiles) {
		const baseName = mdFile.replace(/\.(meta|script)\.md$/i, '');
		const jsFile = baseName + '.js';
		const hasJs = entries.some((e) => e === jsFile);
		const mdPath = join(scriptsDir, mdFile);
		const jsPath = join(scriptsDir, jsFile);

		try {
			const mdRaw = await readFile(mdPath, 'utf-8');
			const mdParsed = matter(mdRaw);
			const data = mdParsed.data as Record<string, unknown>;
			const name = typeof data.name === 'string' ? data.name.trim() : baseName;
			const description = typeof data.description === 'string' ? data.description : undefined;
			const scriptFile = typeof data.scriptFile === 'string' ? data.scriptFile : (hasJs ? jsFile : null);
			const schemas = parseSchema(data.schemas);
			const inputSchema =
				parseSchema(schemas?.input) ??
				parseSchema(data.inputSchema) ??
				undefined;
			const outputSchema =
				parseSchema(schemas?.output) ??
				parseSchema(data.outputSchema) ??
				null;
			const auth = parseSchema(data.auth) ?? null;
			const order = typeof data.order === 'number' ? data.order : typeof data.order === 'string' ? parseInt(data.order, 10) : undefined;
			const resources = parseScriptResources(data.resources);

			let code = '';
			if (hasJs) {
				code = await readFile(jsPath, 'utf-8');
			}

			result.push({
				name,
				description,
				input_schema: inputSchema,
				output_schema: outputSchema,
				script_file: scriptFile ?? null,
				code,
				auth: auth ?? null,
				order: isNaN(order as number) ? undefined : order as number,
				resources
			});
		} catch (err) {
			console.warn(`[skill-folder-reader] skip script ${mdFile}:`, err instanceof Error ? err.message : err);
		}
	}

	// Порядок: по полю order из навыка; при равном/отсутствующем order сохраняем порядок из папки (readdir)
	return result
		.map((s, index) => ({ s, index }))
		.sort((a, b) => {
			const orderA = a.s.order ?? Infinity;
			const orderB = b.s.order ?? Infinity;
			if (orderA !== orderB) return orderA - orderB;
			return a.index - b.index;
		})
		.map(({ s }) => s);
}

async function readWidgets(folderPath: string): Promise<Array<Record<string, unknown>>> {
	const widgetsDir = join(folderPath, 'widgets');
	const scriptsDir = join(folderPath, 'scripts');
	let entries: string[];
	try {
		entries = await readdir(widgetsDir);
	} catch {
		return [];
	}

	const widgetFiles = entries.filter(
		(e) => (e.endsWith('.MD') || e.endsWith('.md')) && !e.toLowerCase().endsWith('.script.md')
	);
	const result: Array<Record<string, unknown>> = [];

	function parseWidgetScripts(value: unknown): Array<Record<string, unknown>> {
		if (!Array.isArray(value)) return [];
		return value
			.filter((item): item is Record<string, unknown> => item != null && typeof item === 'object')
			.map(
				(item):
					| { type: 'inline'; content: string }
					| { type: 'url'; url: string }
					| null => {
					const type = item.type === 'inline' ? 'inline' : item.type === 'url' ? 'url' : null;
					if (type === 'inline') return { type: 'inline' as const, content: String(item.content ?? '') };
					if (type === 'url') return { type: 'url' as const, url: String(item.url ?? '') };
					return null;
				}
			)
			.filter(
				(x): x is { type: 'inline'; content: string } | { type: 'url'; url: string } => x != null
			);
	}

	function parseExternalLibraries(value: unknown): Array<Record<string, unknown>> {
		if (!Array.isArray(value)) return [];
		return value
			.filter((item): item is Record<string, unknown> => item != null && typeof item === 'object')
			.map((item) => ({
				type: String(item.type ?? ''),
				url: String(item.url ?? '')
			}));
	}

	/** Загружает скрипты по ссылкам из scripts/ (виджет импортирует, не дублирует код) */
	async function loadScriptRefs(refs: unknown): Promise<Array<Record<string, unknown>>> {
		if (!Array.isArray(refs)) return [];
		const loaded: Array<Record<string, unknown>> = [];
		for (const ref of refs) {
			const fileName = typeof ref === 'string' ? ref.trim() : '';
			if (!fileName) continue;
			const safeName = fileName.replace(/\.\./g, '').replace(/^\/+/, '');
			const scriptPath = join(scriptsDir, safeName);
			try {
				const content = await readFile(scriptPath, 'utf-8');
				loaded.push({ type: 'inline' as const, content });
			} catch (err) {
				console.warn(`[skill-folder-reader] widget scriptRef "${fileName}" not found:`, err instanceof Error ? err.message : err);
			}
		}
		return loaded;
	}

	for (const file of widgetFiles) {
		const filePath = join(widgetsDir, file);
		try {
			const raw = await readFile(filePath, 'utf-8');
			const parsed = matter(raw);
			const data = parsed.data as Record<string, unknown>;
			const name = typeof data.name === 'string' ? data.name.trim() : file.replace(/\.(md|MD)$/, '');
			const description = typeof data.description === 'string' ? data.description : undefined;
			const schema = parseSchema(data.schema) ?? undefined;
			const template = typeof parsed.content === 'string' ? parsed.content.trim() : '';
			const scriptsFromRefs = await loadScriptRefs(data.scriptRefs);
			const scriptsFromFrontmatter = parseWidgetScripts(data.scripts);
			const scripts = [...scriptsFromRefs, ...scriptsFromFrontmatter];
			const external_libraries = parseExternalLibraries(data.external_libraries);

			result.push({
				name,
				description,
				schema,
				template,
				scripts,
				external_libraries
			});
		} catch (err) {
			console.warn(`[skill-folder-reader] skip widget ${file}:`, err instanceof Error ? err.message : err);
		}
	}

	return result.sort((a, b) => String(a.name).localeCompare(String(b.name)));
}

export async function readSkillFromFolder(folderPath: string): Promise<LocalSkillPayload> {
	const skillMeta = await readSkillMd(folderPath);
	const scripts = await readScripts(folderPath);
	const widgets = await readWidgets(folderPath);

	return {
		name: skillMeta.name,
		description: skillMeta.description,
		body: skillMeta.body,
		scripts,
		widgets,
		mcp_spec: skillMeta.mcp_spec
	};
}

export async function getSkillFolderUpdatedAt(folderPath: string): Promise<string> {
	try {
		const statResult = await stat(folderPath);
		return statResult.mtime.toISOString();
	} catch {
		return new Date().toISOString();
	}
}
