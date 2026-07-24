import ts from 'typescript';
import type { LocalSkillPayload, LocalSkillScript } from './skill-folder-reader.js';

export type LadcraftCapabilityRequirement = {
	type: string;
	operations: string[];
	scope: string;
};

export type LadcraftDeployDiagnosticLevel = 'error' | 'warn' | 'info';

export type LadcraftDeployDiagnosticMessage = {
	level: LadcraftDeployDiagnosticLevel;
	code: string;
	message: string;
};

export type LadcraftScriptRuntimeAnalysis = {
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

export type LadcraftWidgetDeployDiagnostics = {
	name: string;
	widgetExternalHosts: string[];
	warnings: LadcraftDeployDiagnosticMessage[];
};

export type LadcraftScriptDeployDiagnostics = LadcraftScriptRuntimeAnalysis & {
	name: string;
	widgetName: string | null;
};

export type LadcraftDeployDiagnostics = {
	skillName: string;
	scripts: LadcraftScriptDeployDiagnostics[];
	widgets: LadcraftWidgetDeployDiagnostics[];
};

export type LadcraftDeployPayload = {
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

function asRecord(value: unknown): Record<string, unknown> | null {
	return value != null && typeof value === 'object' && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: null;
}

function cloneJsonValue<T>(value: T): T {
	if (Array.isArray(value)) {
		return value.map((item) => cloneJsonValue(item)) as T;
	}
	if (value != null && typeof value === 'object') {
		const out: Record<string, unknown> = {};
		for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
			out[key] = cloneJsonValue(entry);
		}
		return out as T;
	}
	return value;
}

function sortJsonKeys(value: unknown): unknown {
	if (Array.isArray(value)) {
		return value.map((item) => sortJsonKeys(item));
	}
	if (value != null && typeof value === 'object') {
		const out: Record<string, unknown> = {};
		for (const key of Object.keys(value as Record<string, unknown>).sort()) {
			out[key] = sortJsonKeys((value as Record<string, unknown>)[key]);
		}
		return out;
	}
	return value;
}

function jsonValuesEqual(left: unknown, right: unknown): boolean {
	return JSON.stringify(sortJsonKeys(left)) === JSON.stringify(sortJsonKeys(right));
}

const VFS_RUNTIME_OPERATION_ORDER = [
	'readFile',
	'writeFile',
	'listDir',
	'mkdir',
	'rm',
	'exists',
	'isDir'
] as const;

const EMBEDDED_SNIPPET_START = '/*__CURSOR_LADCRAFT_LOCAL_SNIPPET_START__*/';
const EMBEDDED_SNIPPET_END = '/*__CURSOR_LADCRAFT_LOCAL_SNIPPET_END__*/';
const EMBEDDED_WIDGET_PREFIX = '/*__CURSOR_LADCRAFT_WIDGET_NAME__=';

const VFS_OPERATION_ALIASES: Record<string, string> = {
	read: 'readFile',
	readfile: 'readFile',
	write: 'writeFile',
	writefile: 'writeFile',
	list: 'listDir',
	listdir: 'listDir',
	mkdir: 'mkdir',
	delete: 'rm',
	remove: 'rm',
	rm: 'rm',
	exists: 'exists',
	isdir: 'isDir'
};

function normalizeVfsOperationName(operation: string): string {
	const trimmed = operation.trim();
	if (!trimmed) return '';
	const direct = VFS_OPERATION_ALIASES[trimmed.toLowerCase()];
	if (direct) return direct;
	return trimmed;
}

export function normalizeCapabilityRequirementForRuntime(
	cap: LadcraftCapabilityRequirement
): LadcraftCapabilityRequirement {
	const type = cap.type.trim();
	const scope = typeof cap.scope === 'string' && cap.scope.trim() ? cap.scope.trim() : '$USER';
	if (type === 'storage.kv') {
		return {
			type: 'key-value-storage',
			operations: cap.operations.length > 0 ? cap.operations : ['Get', 'Set'],
			scope
		};
	}
	if (type === 'vfs.workspace') {
		const ops = cap.operations.map(normalizeVfsOperationName).filter((o) => o.length > 0);
		const defaultVfs = ['readFile', 'writeFile', 'listDir', 'mkdir', 'rm'];
		return {
			type: 'vfs',
			operations: ops.length > 0 ? ops : defaultVfs,
			scope
		};
	}
	return { ...cap, type, scope };
}

function detectVfsMethodUsage(code: string, method: string): boolean {
	const escaped = method.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
	const patterns = [
		new RegExp(`\\bvfs\\s*\\.\\s*${escaped}\\b`),
		new RegExp(`\\bvfs\\s*\\?\\.\\s*${escaped}\\b`),
		new RegExp(`\\bvfs\\s*\\[\\s*["']${escaped}["']\\s*\\]`)
	];
	return patterns.some((pattern) => pattern.test(code));
}

function collectDetectedVfsRuntimeOperations(code: string): string[] {
	const detected = new Set<string>();
	const add = (operation: string): void => {
		if (operation === 'writeFile') detected.add('mkdir');
		detected.add(operation);
	};
	if (detectVfsMethodUsage(code, 'read') || detectVfsMethodUsage(code, 'readFile')) add('readFile');
	if (detectVfsMethodUsage(code, 'write') || detectVfsMethodUsage(code, 'writeFile')) add('writeFile');
	if (detectVfsMethodUsage(code, 'list') || detectVfsMethodUsage(code, 'listDir')) add('listDir');
	if (detectVfsMethodUsage(code, 'mkdir')) add('mkdir');
	if (detectVfsMethodUsage(code, 'delete') || detectVfsMethodUsage(code, 'rm')) add('rm');
	if (detectVfsMethodUsage(code, 'exists')) add('exists');
	if (detectVfsMethodUsage(code, 'isDir')) add('isDir');
	return VFS_RUNTIME_OPERATION_ORDER.filter((operation) => detected.has(operation));
}

function collectDirectRuntimeVfsMethods(code: string): string[] {
	const methods = ['readFile', 'writeFile', 'listDir', 'mkdir', 'rm', 'exists', 'isDir', 'mv'];
	return methods.filter((method) => detectVfsMethodUsage(code, method));
}

export function resolveCapabilitiesRequiredForLocalScript(
	code: string
): LadcraftCapabilityRequirement[] {
	const required: LadcraftCapabilityRequirement[] = [];
	if (/\bskillStorage\b/.test(code)) {
		required.push({
			type: 'key-value-storage',
			operations: ['Get', 'Set'],
			scope: '$USER'
		});
	}
	const vfsOperations = collectDetectedVfsRuntimeOperations(code);
	if (/\bvfs\b/.test(code) && vfsOperations.length > 0) {
		required.push({
			type: 'vfs',
			operations: vfsOperations,
			scope: '$USER'
		});
	}
	return required;
}

function capabilityIdentityKey(cap: LadcraftCapabilityRequirement): string {
	return `${cap.type}:${cap.scope}`;
}

function unionOperations(left: string[], right: string[]): string[] {
	const combined = new Set<string>([...left, ...right]);
	const ordered = VFS_RUNTIME_OPERATION_ORDER.filter((operation) => combined.has(operation));
	const rest = [...combined].filter((operation) => !ordered.includes(operation as (typeof VFS_RUNTIME_OPERATION_ORDER)[number]));
	return [...ordered, ...rest];
}

export function parseRawCapabilityRequirement(raw: unknown): LadcraftCapabilityRequirement | null {
	const r = asRecord(raw);
	if (!r) return null;
	const type = typeof r.type === 'string' ? r.type.trim() : '';
	if (!type) return null;
	const opsRaw = r.operations;
	const operations = Array.isArray(opsRaw)
		? opsRaw
				.filter((o): o is string => typeof o === 'string' && o.trim().length > 0)
				.map((o) => o.trim())
		: [];
	const scope = typeof r.scope === 'string' && r.scope.trim().length > 0 ? r.scope.trim() : '$USER';
	return { type, operations, scope };
}

export function resolveMcpSpecDefaultCapabilitiesRequired(
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

export function mergeCapabilitiesRequiredLists(
	auto: LadcraftCapabilityRequirement[],
	explicit: LadcraftCapabilityRequirement[]
): LadcraftCapabilityRequirement[] {
	const map = new Map<string, LadcraftCapabilityRequirement>();
	for (const cap of auto.map(normalizeCapabilityRequirementForRuntime)) {
		map.set(capabilityIdentityKey(cap), cap);
	}
	for (const cap of explicit.map(normalizeCapabilityRequirementForRuntime)) {
		const existing = map.get(capabilityIdentityKey(cap));
		if (!existing) {
			map.set(capabilityIdentityKey(cap), cap);
			continue;
		}
		map.set(capabilityIdentityKey(cap), {
			...existing,
			operations: unionOperations(existing.operations, cap.operations)
		});
	}
	return [...map.values()];
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
	const lastLine = tailLines[tailLines.length - 1] ?? '';
	return (
		/^returnResult\(__result\);$/.test(lastLine) ||
		/^returnResultInWidget\(\s*['"`][^'"`]+['"`]\s*,\s*__result\s*\);$/.test(lastLine)
	);
}

export function stripLocalVmHandlerBootstrapSuffix(source: string): string {
	const trimmed = source.trim();
	const bootstrapMarker =
		'const __result = await handler({ environment: { app: {}, user: {} }, capabilities: {} }, input);';
	const bootstrapIndex = trimmed.lastIndexOf(bootstrapMarker);
	if (bootstrapIndex < 0 || !hasLocalVmHandlerBootstrapSuffix(trimmed)) {
		return trimmed;
	}
	return trimmed.slice(0, bootstrapIndex).trim();
}

export function extractWidgetNameFromLocalCode(code: string): string | null {
	const explicitMatch = code.match(/returnResultInWidget\(\s*['"`]([^'"`]+)['"`]/);
	if (explicitMatch?.[1]) {
		return explicitMatch[1].trim();
	}
	const embeddedMatch = code.match(/__CURSOR_LADCRAFT_WIDGET_NAME__=([^\*]+)\*\//);
	return embeddedMatch?.[1]?.trim() || null;
}

export function hasEjsSyntax(template: string): boolean {
	return /<%[=-]?[\s\S]*?%>/.test(template);
}

export function hasHandlebarsBlockSyntax(template: string): boolean {
	return /{{\s*(?:[#/^]|else\b)/.test(template);
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

export function extractNetworkHostsFromContent(content: string): string[] {
	const hosts = new Set<string>();
	const matches = content.matchAll(/https?:\/\/([^\/"'`\s)]+)/g);
	for (const match of matches) {
		if (match[1]) {
			hosts.add(match[1]);
		}
	}
	return [...hosts];
}

export function analyzeScriptCodeForLadcraftRuntime(code: string): LadcraftScriptRuntimeAnalysis {
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
	const capabilitiesRequired = resolveCapabilitiesRequiredForLocalScript(code);
	const directRuntimeVfsMethods = collectDirectRuntimeVfsMethods(code);

	if (usesSkillStorage) {
		warnings.push({
			level: 'info',
			code: 'uses-skill-storage',
			message:
				'Скрипт использует skillStorage; при деплое будет добавлен capability key-value-storage (runtime KV).'
		});
	}
	if (usesVfs) {
		const vfsOps = capabilitiesRequired.find((cap) => cap.type === 'vfs')?.operations ?? [];
		warnings.push({
			level: 'info',
			code: 'uses-vfs',
			message:
				vfsOps.length > 0
					? `Скрипт использует vfs; при деплое будет добавлен capability vfs (${vfsOps.join(', ')}).`
					: 'Скрипт использует vfs; проверь, что вызовы VFS распознаются builder-ом.'
		});
	}
	if (handlerStyle === 'legacy-script-input' && directRuntimeVfsMethods.length > 0) {
		warnings.push({
			level: 'warn',
			code: 'legacy-runtime-vfs-methods',
			message:
				`Legacy-вход скрипта использует runtime-only VFS методы (${directRuntimeVfsMethods.join(', ')}). После миграции оставьте только canonical handler и используйте согласованный VFS runtime shape.`
		});
	}
	if (detectVfsMethodUsage(code, 'mv')) {
		warnings.push({
			level: 'warn',
			code: 'uses-vfs-mv',
			message:
				'Скрипт использует vfs.mv; этот вызов не входит в каноничный runtime-контракт и требует отдельной проверки совместимости.'
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
				'Скрипт обращается к node:fs/fs; в каноничном skill-контракте используйте capability-driven VFS/runtime API, а не прямой доступ к файловой системе.'
		});
	}
	if (usesPath) {
		warnings.push({
			level: 'warn',
			code: 'uses-path',
			message:
				'Скрипт обращается к node:path/path; проверь, что код действительно совместим с runtime и не зависит от локального FS.'
		});
	}
	if (usesBuffer) {
		warnings.push({
			level: 'warn',
			code: 'uses-buffer',
			message: 'Скрипт использует Buffer; проверь совместимость с Ladcraft runtime.'
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
		capabilitiesRequired,
		warnings
	};
}

function unwrapParenthesizedExpression(expression: ts.Expression): ts.Expression {
	let current = expression;
	while (ts.isParenthesizedExpression(current)) {
		current = current.expression;
	}
	return current;
}

function stripSharedIndentation(value: string): string {
	const lines = value.replace(/\r\n/g, '\n').split('\n');
	const indents = lines
		.filter((line) => line.trim().length > 0)
		.map((line) => line.match(/^(\s*)/)?.[1].length ?? 0);
	const minIndent = indents.length > 0 ? Math.min(...indents) : 0;
	return lines.map((line) => line.slice(minIndent)).join('\n').trim();
}

function extractGeneratedWrapperBody(code: string): string | null {
	const snippetStart = code.indexOf(EMBEDDED_SNIPPET_START);
	const snippetEnd = code.indexOf(EMBEDDED_SNIPPET_END);
	if (snippetStart >= 0 && snippetEnd > snippetStart) {
		return stripSharedIndentation(
			code.slice(snippetStart + EMBEDDED_SNIPPET_START.length, snippetEnd)
		);
	}
	const tryMarker = '      try {\n';
	const catchMarker = '\n      } catch (error) {';
	const promiseMarker = '  return await new Promise((resolve, reject) => {';
	if (
		code.indexOf(promiseMarker) < 0 ||
		code.indexOf('const returnResult =') < 0 ||
		code.indexOf('const returnResultInWidget =') < 0
	) {
		return null;
	}
	const bodyStart = code.indexOf(tryMarker);
	const bodyEnd = code.lastIndexOf(catchMarker);
	if (bodyStart < 0 || bodyEnd <= bodyStart) {
		return null;
	}
	return stripSharedIndentation(code.slice(bodyStart + tryMarker.length, bodyEnd));
}

function expandTopLevelAsyncIifes(body: string): string {
	const sourceFile = ts.createSourceFile('legacy-body.js', body, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
	const pieces: string[] = [];
	for (const statement of sourceFile.statements) {
		if (ts.isExpressionStatement(statement) && ts.isCallExpression(statement.expression)) {
			const callee = unwrapParenthesizedExpression(statement.expression.expression);
			if ((ts.isFunctionExpression(callee) || ts.isArrowFunction(callee)) && callee.body && ts.isBlock(callee.body)) {
				pieces.push(callee.body.statements.map((item) => item.getText(sourceFile)).join('\n'));
				continue;
			}
		}
		pieces.push(statement.getText(sourceFile));
	}
	return pieces.filter(Boolean).join('\n');
}

function canRewriteLegacyResultCalls(body: string): boolean {
	if (/\bgetOAuthToken\b/.test(body) || /\bgetTelegramChatId\b/.test(body)) {
		return false;
	}
	const sourceFile = ts.createSourceFile('legacy-body.js', body, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
	let safe = true;
	const visit = (node: ts.Node): void => {
		if (!safe) return;
		if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
			const name = node.expression.text;
			if (name === 'returnResult' || name === 'returnResultInWidget') {
				if (!ts.isExpressionStatement(node.parent)) {
					safe = false;
					return;
				}
				let ancestor: ts.Node | undefined = node.parent.parent;
				while (ancestor && ancestor !== sourceFile) {
					if (ts.isFunctionLike(ancestor)) {
						safe = false;
						return;
					}
					ancestor = ancestor.parent;
				}
			}
		}
		ts.forEachChild(node, visit);
	};
	ts.forEachChild(sourceFile, visit);
	return safe;
}

function applyTextChanges(source: string, changes: Array<{ start: number; end: number; text: string }>): string {
	return changes
		.sort((left, right) => right.start - left.start)
		.reduce(
			(result, change) =>
				result.slice(0, change.start) + change.text + result.slice(change.end),
			source
		);
}

function rewriteLegacyResultCalls(
	body: string,
	preferredWidgetName: string | null
): { body: string; widgetName: string | null } {
	const sourceFile = ts.createSourceFile('legacy-body.js', body, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
	const changes: Array<{ start: number; end: number; text: string }> = [];
	let widgetName = preferredWidgetName;
	const visit = (node: ts.Node): void => {
		if (ts.isExpressionStatement(node) && ts.isCallExpression(node.expression) && ts.isIdentifier(node.expression.expression)) {
			const calleeName = node.expression.expression.text;
			if (calleeName === 'returnResult' && node.expression.arguments.length >= 1) {
				const value = node.expression.arguments[0]!.getText(sourceFile);
				changes.push({ start: node.getStart(sourceFile), end: node.getEnd(), text: `return ${value};` });
			}
			if (calleeName === 'returnResultInWidget' && node.expression.arguments.length >= 2) {
				const widgetArg = node.expression.arguments[0]!;
				if (
					(widgetName == null || widgetName.length === 0) &&
					(ts.isStringLiteral(widgetArg) || ts.isNoSubstitutionTemplateLiteral(widgetArg))
				) {
					widgetName = widgetArg.text.trim();
				}
				const value = node.expression.arguments[1]!.getText(sourceFile);
				changes.push({ start: node.getStart(sourceFile), end: node.getEnd(), text: `return ${value};` });
			}
		}
		ts.forEachChild(node, visit);
	};
	ts.forEachChild(sourceFile, visit);
	return {
		body: applyTextChanges(body, changes),
		widgetName
	};
}

function buildCanonicalHandlerFromBody(body: string, widgetName: string | null): string {
	const usesInput = /\binput\b/.test(body);
	const usesEnv = /\benv\b/.test(body);
	const usesAppEnv = /\bappEnv\b/.test(body);
	const usesUserEnv = /\buserEnv\b/.test(body);
	const usesSkillStorage = /\bskillStorage\b/.test(body);
	const usesVfs = /\bvfs\b/.test(body);
	const lines = ['async function handler(state, params) {', `  ${EMBEDDED_WIDGET_PREFIX}${widgetName ?? ''}*/`];
	if (usesInput) {
		lines.push('  const input = params;');
	}
	if (usesEnv || usesAppEnv || usesUserEnv) {
		lines.push('  const appEnv = state.environment?.app ?? {};', '  const userEnv = state.environment?.user ?? {};');
		if (usesEnv) {
			lines.push('  const env = { ...appEnv, ...userEnv };');
		}
	}
	if (usesSkillStorage || usesVfs) {
		lines.push('  /** @type {any} */', '  const __caps = state.capabilities ?? {};');
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
			'    /** @type {any} */',
			'    const source = raw;',
			'    if (typeof source.read === "function" && typeof source.write === "function") return source;',
			'    if (typeof source.readFile !== "function" || typeof source.writeFile !== "function") return null;',
			'    const mkdir = typeof source.mkdir === "function" ? (p) => source.mkdir(p) : async () => undefined;',
			'    const listDir = typeof source.listDir === "function" ? (p) => source.listDir(p) : async () => [];',
			'    const rm = typeof source.rm === "function" ? (p) => source.rm(p) : async () => undefined;',
			'    return {',
			'      read: (p) => source.readFile(p),',
			'      write: (p, c) => source.writeFile(p, c),',
			'      mkdir,',
			'      list: listDir,',
			'      listDir,',
			'      delete: rm,',
			'      rm',
			'    };',
			'  })(__caps.vfs);'
		);
	}
	lines.push(...stripSharedIndentation(body).split('\n').map((line) => `  ${line}`));
	lines.push('}');
	return lines.join('\n');
}

function tryConvertLegacyCodeToCanonicalHandler(
	code: string,
	widgetName: string | null
): string | null {
	const expanded = expandTopLevelAsyncIifes(code);
	if (!canRewriteLegacyResultCalls(expanded)) {
		return null;
	}
	const rewritten = rewriteLegacyResultCalls(expanded, widgetName);
	return buildCanonicalHandlerFromBody(rewritten.body, rewritten.widgetName);
}

export function wrapLocalCodeForLadcraftHandler(code: string, widgetName: string | null): string {
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
		'      try {',
		...code
			.split('\n')
			.map((line) => `        ${line}`),
		'      } catch (error) {',
		'        reject(error);',
		'      }',
		'    })();',
		'  });',
		'}'
	);
	return lines.join('\n');
}

export function normalizeToolCodeForStorage(code: string, widgetName: string | null): string {
	const trimmed = code.trim();
	if (!trimmed) {
		return '';
	}
	if (/\basync\s+function\s+handler\s*\(/.test(trimmed)) {
		const stripped = stripLocalVmHandlerBootstrapSuffix(trimmed);
		const body = extractGeneratedWrapperBody(stripped);
		if (body) {
			const converted = tryConvertLegacyCodeToCanonicalHandler(body, widgetName);
			if (converted) {
				return converted;
			}
		}
		return stripped;
	}
	const converted = tryConvertLegacyCodeToCanonicalHandler(trimmed, widgetName);
	if (converted) {
		return converted;
	}
	return wrapLocalCodeForLadcraftHandler(trimmed, widgetName);
}

export function normalizeLocalSkillPayloadForStorage(payload: LocalSkillPayload): {
	payload: LocalSkillPayload;
	changed: boolean;
} {
	const effectivePayload: LocalSkillPayload = {
		...payload,
		scripts: (payload.scripts ?? []).map((script) => ({ ...script })),
		widgets: (payload.widgets ?? []).map((widget) => {
			const record = asRecord(widget);
			return record ? { ...record } : widget;
		})
	};
	const originalScriptCount = effectivePayload.scripts.length;
	ensureWidgetScript(effectivePayload);
	let changed = effectivePayload.scripts.length !== originalScriptCount;
	effectivePayload.scripts = effectivePayload.scripts.map((script) => {
		const { widgetName } = resolveWidgetForScript(effectivePayload, script);
		const normalizedCode = normalizeToolCodeForStorage(script.code ?? '', widgetName);
		if (normalizedCode !== (script.code ?? '')) {
			changed = true;
		}
		return {
			...script,
			code: normalizedCode
		};
	});
	for (const script of effectivePayload.scripts) {
		const outputSchema = asRecord(script.output_schema);
		if (!outputSchema) continue;
		const { widget } = resolveWidgetForScript(effectivePayload, script);
		if (!widget) continue;
		const currentSchema = asRecord(widget.schema) ?? {};
		if (jsonValuesEqual(currentSchema, outputSchema)) continue;
		widget.schema = cloneJsonValue(outputSchema);
		changed = true;
	}
	return {
		payload: effectivePayload,
		changed
	};
}

export function buildWidgetHtmlSource(widget: Record<string, unknown>): string {
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

export function resolveWidgetForScript(
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

export function ensureWidgetScript(payload: LocalSkillPayload): void {
	if (payload.scripts.length > 0 || payload.widgets.length === 0) return;
	const firstWidget = payload.widgets.find((item) => asRecord(item) != null);
	if (!firstWidget) return;
	const widgetNameRaw = String(firstWidget.name ?? '').trim();
	const widgetName = widgetNameRaw || 'widget';
	const widgetSchema = (
		firstWidget.schema && typeof firstWidget.schema === 'object' ? firstWidget.schema : {}
	) as {
		type?: string;
		properties?: Record<string, unknown>;
		required?: string[];
	};
	const normalizedWidgetName =
		widgetNameRaw.replace(/[^a-zA-Z0-9_]/g, '').replace(/^[0-9]/, '') || 'widget';
	const scriptName =
		normalizedWidgetName !== 'widget'
			? `launch${normalizedWidgetName.charAt(0).toUpperCase() + normalizedWidgetName.slice(1)}`
			: 'launchWidget';
	const inputSchema: Record<string, unknown> = {
		type: 'object',
		properties: widgetSchema.properties || {},
		required: widgetSchema.required || []
	};
	const scriptCode = `// Автоматически созданный скрипт для запуска виджета "${widgetName}"
// Передает входные параметры в виджет для отображения

async function handler(state, params) {
  /*__CURSOR_LADCRAFT_WIDGET_NAME__=${widgetName}*/
  return params;
}
`;
	payload.scripts.push({
		name: scriptName,
		description: `Запускает виджет "${widgetName}" с переданными параметрами`,
		input_schema: inputSchema,
		output_schema: null,
		script_file: null,
		code: scriptCode,
		auth: null
	});
}

export function resolveMcpToolEnvironment(
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
					typeof vr?.title === 'string' && vr.title.trim().length > 0 ? vr.title.trim() : k;
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

export function buildLadcraftDeployDiagnostics(
	payload: LocalSkillPayload
): LadcraftDeployDiagnostics {
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

export async function convertLocalSkillToLadcraftPayload(
	payload: LocalSkillPayload,
	options: {
		resolveDefaultCategory: () => Promise<string>;
		skillNameOverride?: string | null;
	}
): Promise<LadcraftDeployPayload> {
	const normalized = normalizeLocalSkillPayloadForStorage(payload).payload;
	const effectivePayload: LocalSkillPayload = {
		...normalized,
		scripts: [...(normalized.scripts ?? [])],
		widgets: (normalized.widgets ?? []).map((widget) => {
			const record = asRecord(widget);
			return record ? { ...record } : widget;
		})
	};
	ensureWidgetScript(effectivePayload);
	const category = await options.resolveDefaultCategory();
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
		const mergedCaps = mergeCapabilitiesRequiredLists(autoCaps, defaultCaps);
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
		name: options.skillNameOverride?.trim() || effectivePayload.name.trim(),
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

export function extractEmbeddedLocalSnippet(
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
