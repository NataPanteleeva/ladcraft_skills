import type { LocalSkillPayload } from './skill-folder-reader.js';

function isRecord(value: unknown): value is Record<string, unknown> {
	return value != null && typeof value === 'object' && !Array.isArray(value);
}

function defaultScriptFileName(scriptName: string): string {
	return `${scriptName.replace(/[^a-z0-9_-]/gi, '_')}.js`;
}

function normalizeLineEndings(value: string): string {
	return value.replace(/\r\n/g, '\n');
}

function dedentMultilineText(value: string): string {
	const normalized = normalizeLineEndings(value).trim();
	if (!normalized) return '';
	const lines = normalized.split('\n');
	const indents = lines
		.filter((line) => line.trim().length > 0)
		.map((line) => line.match(/^[ \t]*/)?.[0].length ?? 0);
	const minIndent = indents.length > 0 ? Math.min(...indents) : 0;
	return lines
		.map((line) => line.slice(Math.min(minIndent, line.length)).replace(/[ \t]+$/g, ''))
		.join('\n')
		.trim();
}

function normalizeWidgetMarker(value: string): string {
	return value.replace(
		/\/\*__CURSOR_LADCRAFT_WIDGET_NAME__=[^\*]*\*\//g,
		'/*__CURSOR_LADCRAFT_WIDGET_NAME__*/'
	);
}

function normalizeScriptCode(value: string): string {
	const dedented = dedentMultilineText(normalizeWidgetMarker(value));
	if (!dedented) return '';
	return dedented
		.split('\n')
		.map((line) => line.trim())
		.join('\n')
		.trim();
}

function normalizeArrayByJson(value: unknown[]): unknown[] {
	return value
		.map((item) => sortKeys(item))
		.sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
}

function sortKeys(obj: unknown): unknown {
	if (obj === null || typeof obj !== 'object') return obj;
	if (Array.isArray(obj)) return obj.map(sortKeys);
	const sorted: Record<string, unknown> = {};
	for (const key of Object.keys(obj as Record<string, unknown>).sort()) {
		sorted[key] = sortKeys((obj as Record<string, unknown>)[key]);
	}
	return sorted;
}

function normalizeDefaultCapabilityItem(raw: unknown): Record<string, unknown> | null {
	if (!isRecord(raw)) return null;
	const type = typeof raw.type === 'string' ? raw.type.trim() : '';
	if (!type) return null;
	const scope = typeof raw.scope === 'string' && raw.scope.trim() ? raw.scope.trim() : '$USER';
	const operations = Array.isArray(raw.operations)
		? [...new Set(raw.operations.filter((op): op is string => typeof op === 'string').map((op) => op.trim()).filter(Boolean))].sort()
		: [];
	return {
		type,
		scope,
		operations
	};
}

function normalizeMcpSpec(value: Record<string, unknown> | null | undefined): Record<string, unknown> | null {
	if (!isRecord(value) || Object.keys(value).length === 0) return null;
	const out: Record<string, unknown> = { ...value };
	const toolsRaw = Array.isArray(value.tools) ? value.tools : [];
	if (toolsRaw.length > 0) {
		const normalizedTools = toolsRaw
			.filter((item): item is Record<string, unknown> => isRecord(item))
			.map((tool) => {
				const normalizedTool: Record<string, unknown> = {
					...tool,
					name: typeof tool.name === 'string' ? tool.name.trim() : ''
				};
				if (isRecord(tool.environment)) {
					normalizedTool.environment = sortKeys(tool.environment) as Record<string, unknown>;
				}
				return normalizedTool;
			});
		out.tools = normalizeArrayByJson(normalizedTools);
	} else {
		delete out.tools;
	}
	const defaultCapabilities = isRecord(value.default_capabilities)
		? value.default_capabilities
		: null;
	if (defaultCapabilities) {
		const requiredRaw = Array.isArray(defaultCapabilities.required)
			? defaultCapabilities.required
			: [];
		const required = normalizeArrayByJson(
			requiredRaw
				.map((item) => normalizeDefaultCapabilityItem(item))
				.filter((item): item is Record<string, unknown> => item != null)
		);
		if (required.length > 0) {
			out.default_capabilities = { required };
		} else {
			delete out.default_capabilities;
		}
	}
	return Object.keys(out).length > 0 ? (sortKeys(out) as Record<string, unknown>) : null;
}

function normalizeScriptResources(
	value: unknown
): {
	cpu?: number;
	gpu?: number;
	memory?: number;
	timeout?: number;
	network?: { hosts?: string[] };
} | undefined {
	if (!isRecord(value)) return undefined;
	const out: {
		cpu?: number;
		gpu?: number;
		memory?: number;
		timeout?: number;
		network?: { hosts?: string[] };
	} = {};
	const cpu = typeof value.cpu === 'number' && Number.isFinite(value.cpu) ? value.cpu : undefined;
	const gpu = typeof value.gpu === 'number' && Number.isFinite(value.gpu) ? value.gpu : undefined;
	const memory =
		typeof value.memory === 'number' && Number.isFinite(value.memory) ? value.memory : undefined;
	const timeout =
		typeof value.timeout === 'number' && Number.isFinite(value.timeout) ? value.timeout : undefined;
	if (cpu !== undefined && cpu !== 0.2) out.cpu = cpu;
	if (gpu !== undefined) out.gpu = gpu;
	if (memory !== undefined && memory !== 128) out.memory = memory;
	if (timeout !== undefined && timeout !== 30) out.timeout = timeout;
	const network = isRecord(value.network) ? value.network : null;
	if (network && Array.isArray(network.hosts)) {
		const hosts = [...new Set(network.hosts.filter((h): h is string => typeof h === 'string').map((h) => h.trim()).filter(Boolean))].sort();
		if (hosts.length > 0) {
			out.network = { hosts };
		}
	}
	return Object.keys(out).length > 0 ? out : undefined;
}

/**
 * Normalizes semantically equivalent payload shapes before conflict comparison.
 * This avoids false positives caused by filesystem defaults like omitted widget schema
 * or implicit default script filenames.
 */
export function normalizeSkillPayloadForComparison(payload: LocalSkillPayload): LocalSkillPayload {
	const normalizedScripts = (payload.scripts ?? [])
		.map((script) => {
			const defaultScriptFile = defaultScriptFileName(script.name);
			const resources = normalizeScriptResources(script.resources);
			return {
				name: script.name,
				description: script.description ?? '',
				input_schema:
					isRecord(script.input_schema) && Object.keys(script.input_schema).length > 0
						? (sortKeys(script.input_schema) as Record<string, unknown>)
						: {},
				output_schema: isRecord(script.output_schema)
					? (sortKeys(script.output_schema) as Record<string, unknown>)
					: null,
				script_file:
					script.script_file == null || script.script_file === defaultScriptFile
						? null
						: script.script_file,
				code: normalizeScriptCode(script.code ?? ''),
				auth: isRecord(script.auth) ? (sortKeys(script.auth) as Record<string, unknown>) : null,
				order: typeof script.order === 'number' ? script.order : undefined,
				resources
			};
		})
		.sort((left, right) =>
			`${left.name}:${left.order ?? Number.MAX_SAFE_INTEGER}`.localeCompare(
				`${right.name}:${right.order ?? Number.MAX_SAFE_INTEGER}`
			)
		);
	const normalizedWidgets = (payload.widgets ?? [])
		.map((widget) => {
			const schema = isRecord(widget.schema) ? (sortKeys(widget.schema) as Record<string, unknown>) : {};
			const scripts = Array.isArray(widget.scripts) ? normalizeArrayByJson(widget.scripts) : [];
			const externalLibraries = Array.isArray(widget.external_libraries)
				? normalizeArrayByJson(widget.external_libraries)
				: [];
			return {
				// Игнорируем file/name mapping: сравниваем только полезный контракт и html.
				schema,
				template: dedentMultilineText(String(widget.template ?? '')),
				scripts,
				external_libraries: externalLibraries
			};
		})
		.sort((left, right) =>
			JSON.stringify(sortKeys(left)).localeCompare(JSON.stringify(sortKeys(right)))
		);
	return {
		name: payload.name,
		description: payload.description,
		body: payload.body,
		mcp_spec: normalizeMcpSpec(payload.mcp_spec ?? null),
		scripts: normalizedScripts,
		widgets: normalizedWidgets
	};
}

export function payloadsEqual(a: LocalSkillPayload, b: LocalSkillPayload): boolean {
	return JSON.stringify(sortKeys(normalizeSkillPayloadForComparison(a))) ===
		JSON.stringify(sortKeys(normalizeSkillPayloadForComparison(b)));
}
