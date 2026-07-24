import path from 'node:path';
import ts from 'typescript';
import type { LadcraftDeployDiagnostics } from './skill-builder.js';
import { skillRuntimeDeclarations } from './skill-runtime-declarations.js';

export type SkillValidationIssue = {
	severity: 'error' | 'warning';
	source: 'typescript' | 'structure' | 'runtime' | 'publish';
	filePath: string | null;
	message: string;
	code: string | number | null;
	line: number | null;
	column: number | null;
};

export type SkillValidationReport = {
	skillName: string;
	issues: SkillValidationIssue[];
	errors: SkillValidationIssue[];
	warnings: SkillValidationIssue[];
	isBlocking: boolean;
	summaryText: string;
	copyText: string;
	chatText: string;
};

type VirtualValidationFile = {
	filePath: string;
	content: string;
	inputSchema?: Record<string, unknown> | null;
	outputSchema?: Record<string, unknown> | null;
};

type SchemaContext = {
	filePath: string;
	typeLabel: string;
	issues: SkillValidationIssue[];
};

const UNUSED_DIAGNOSTIC_CODES = new Set([6133, 6192, 6196, 6198]);

function normalizeIssueMessage(message: string): string {
	return message.replace(/\s+/g, ' ').trim();
}

function formatIssuePrefix(issue: SkillValidationIssue): string {
	const location =
		issue.filePath && issue.line != null && issue.column != null
			? `${issue.filePath}:${issue.line}:${issue.column}`
			: issue.filePath ?? 'skill';
	const code = issue.code != null ? ` ${issue.code}` : '';
	return `[${issue.source}${code}] ${location}`;
}

function formatSkillValidationReport(report: SkillValidationReport, header: string): string {
	const lines = [header, report.summaryText];
	if (report.errors.length > 0) {
		lines.push('', 'Errors:');
		for (const issue of report.errors) {
			lines.push(`- ${formatIssuePrefix(issue)} ${issue.message}`);
		}
	}
	if (report.warnings.length > 0) {
		lines.push('', 'Warnings:');
		for (const issue of report.warnings) {
			lines.push(`- ${formatIssuePrefix(issue)} ${issue.message}`);
		}
	}
	return lines.join('\n');
}

export function createSkillValidationReport(
	skillName: string,
	issues: SkillValidationIssue[]
): SkillValidationReport {
	const normalizedIssues = issues.map((issue) => ({
		...issue,
		message: normalizeIssueMessage(issue.message)
	}));
	const errors = normalizedIssues.filter((issue) => issue.severity === 'error');
	const warnings = normalizedIssues.filter((issue) => issue.severity === 'warning');
	const base = {
		skillName,
		issues: normalizedIssues,
		errors,
		warnings,
		isBlocking: errors.length > 0
	};
	const summaryText = `Errors: ${errors.length}, warnings: ${warnings.length}`;
	const copyText = formatSkillValidationReport(
		{ ...base, summaryText, copyText: '', chatText: '' },
		`Skill "${skillName}" validation report`
	);
	const chatText = [`Исправь навык "${skillName}". Ниже отчёт валидатора.`, '', copyText].join(
		'\n'
	);
	return {
		...base,
		summaryText,
		copyText,
		chatText
	};
}

function buildCompilerOptions(): ts.CompilerOptions {
	return {
		target: ts.ScriptTarget.ES2020,
		module: ts.ModuleKind.ESNext,
		moduleResolution: ts.ModuleResolutionKind.NodeJs,
		allowJs: true,
		allowNonTsExtensions: true,
		checkJs: true,
		strict: false,
		noEmit: true,
		skipLibCheck: true,
		lib: ['lib.es2020.d.ts']
	};
}

function asRecord(value: unknown): Record<string, unknown> | null {
	return value != null && typeof value === 'object' && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: null;
}

function createSchemaIssue(
	filePath: string,
	typeLabel: string,
	message: string,
	severity: SkillValidationIssue['severity'] = 'warning'
): SkillValidationIssue {
	return {
		severity,
		source: 'typescript',
		filePath,
		message: `${typeLabel}: ${message}`,
		code: 'schema-parity',
		line: null,
		column: null
	};
}

function quotePropertyName(name: string): string {
	return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name) ? name : JSON.stringify(name);
}

function literalToTs(value: unknown): string | null {
	if (typeof value === 'string') return JSON.stringify(value);
	if (typeof value === 'number' && Number.isFinite(value)) return String(value);
	if (typeof value === 'boolean') return value ? 'true' : 'false';
	if (value === null) return 'null';
	return null;
}

function indentBlock(value: string, level: number): string {
	const indent = '  '.repeat(level);
	return value
		.split('\n')
		.map((line) => (line ? `${indent}${line}` : line))
		.join('\n');
}

function mergeSchemaVariant(
	base: Record<string, unknown>,
	variant: Record<string, unknown>
): Record<string, unknown> {
	const baseProperties = asRecord(base.properties) ?? {};
	const variantProperties = asRecord(variant.properties) ?? {};
	const baseRequired = Array.isArray(base.required)
		? base.required.filter((item): item is string => typeof item === 'string')
		: [];
	const variantRequired = Array.isArray(variant.required)
		? variant.required.filter((item): item is string => typeof item === 'string')
		: [];
	return {
		...base,
		...variant,
		properties: {
			...baseProperties,
			...variantProperties
		},
		required: [...new Set([...baseRequired, ...variantRequired])],
		anyOf: undefined,
		oneOf: undefined,
		allOf: undefined
	};
}

function schemaToTypeSource(
	schema: Record<string, unknown> | null | undefined,
	context: SchemaContext,
	level = 0
): string {
	const record = asRecord(schema);
	if (!record) {
		context.issues.push(
			createSchemaIssue(context.filePath, context.typeLabel, 'schema отсутствует или не является объектом')
		);
		return 'unknown';
	}

	if (Array.isArray(record.anyOf) && record.anyOf.length > 0) {
		const members = record.anyOf
			.map((item) => asRecord(item))
			.filter((item): item is Record<string, unknown> => item != null)
			.map((item) => schemaToTypeSource(mergeSchemaVariant(record, item), context, level));
		return members.length > 0 ? [...new Set(members)].join(' | ') : 'unknown';
	}
	if (Array.isArray(record.oneOf) && record.oneOf.length > 0) {
		const members = record.oneOf
			.map((item) => asRecord(item))
			.filter((item): item is Record<string, unknown> => item != null)
			.map((item) => schemaToTypeSource(mergeSchemaVariant(record, item), context, level));
		return members.length > 0 ? [...new Set(members)].join(' | ') : 'unknown';
	}
	if (Array.isArray(record.allOf) && record.allOf.length > 0) {
		const merged = record.allOf
			.map((item) => asRecord(item))
			.filter((item): item is Record<string, unknown> => item != null)
			.reduce((acc, item) => mergeSchemaVariant(acc, item), {
				...record,
				allOf: undefined
			} as Record<string, unknown>);
		return schemaToTypeSource(merged, context, level);
	}

	const enumValues = Array.isArray(record.enum) ? record.enum : null;
	if (enumValues && enumValues.length > 0) {
		const literals = enumValues.map(literalToTs);
		if (literals.every((value) => typeof value === 'string')) {
			return literals.join(' | ');
		}
		context.issues.push(
			createSchemaIssue(
				context.filePath,
				context.typeLabel,
				'enum содержит неподдерживаемые значения; используется fallback unknown'
			)
		);
		return 'unknown';
	}

	const rawType = record.type;
	if (Array.isArray(rawType)) {
		const members = rawType
			.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
			.map((item) =>
				schemaToTypeSource(
					{
						...record,
						type: item
					},
					context,
					level
				)
			);
		return members.length > 0 ? [...new Set(members)].join(' | ') : 'unknown';
	}

	const type =
		typeof rawType === 'string'
			? rawType
			: record.properties || record.additionalProperties != null
				? 'object'
				: record.items
					? 'array'
					: null;

	switch (type) {
		case 'string':
			return 'string';
		case 'number':
		case 'integer':
			return 'number';
		case 'boolean':
			return 'boolean';
		case 'null':
			return 'null';
		case 'array': {
			const itemType = record.items ? schemaToTypeSource(asRecord(record.items), context, level + 1) : 'unknown';
			return `Array<${itemType}>`;
		}
		case 'object': {
			const properties = asRecord(record.properties) ?? {};
			const required = new Set(
				Array.isArray(record.required)
					? record.required.filter((item): item is string => typeof item === 'string')
					: []
			);
			const lines = Object.entries(properties).map(([name, value]) => {
				const propertyType = schemaToTypeSource(asRecord(value), context, level + 1);
				return `${quotePropertyName(name)}${required.has(name) ? '' : '?'}: ${propertyType};`;
			});
			const additional = record.additionalProperties;
			if (additional !== false) {
				if (additional == null || additional === true) {
					lines.push('[key: string]: unknown;');
				} else {
					const additionalType = schemaToTypeSource(asRecord(additional), context, level + 1);
					lines.push(`[key: string]: ${additionalType};`);
				}
			}
			if (lines.length === 0) {
				return additional === false ? '{}' : 'Record<string, unknown>';
			}
			return `{\n${indentBlock(lines.join('\n'), level + 1)}\n${'  '.repeat(level)}}`;
		}
		default:
			context.issues.push(
				createSchemaIssue(
					context.filePath,
					context.typeLabel,
					`неподдерживаемый schema.type "${String(rawType ?? '') || 'undefined'}"; используется fallback unknown`
				)
			);
			return 'unknown';
	}
}

function buildParityTypeDefinitions(file: VirtualValidationFile, index: number): {
	content: string;
	issues: SkillValidationIssue[];
} {
	const issues: SkillValidationIssue[] = [];
	const inputContext: SchemaContext = {
		filePath: file.filePath,
		typeLabel: `SkillParams__tool_${index}`,
		issues
	};
	const outputContext: SchemaContext = {
		filePath: file.filePath,
		typeLabel: `SkillResult__tool_${index}`,
		issues
	};
	const inputType = schemaToTypeSource(file.inputSchema ?? { type: 'object', additionalProperties: false }, inputContext);
	const outputType = schemaToTypeSource(file.outputSchema ?? { type: 'object', additionalProperties: true }, outputContext);
	return {
		content: [
			`type SkillState__tool_${index} = {`,
			`  environment: { app: Record<string, unknown>; user: Record<string, unknown> };`,
			`  capabilities: Record<string, unknown>;`,
			`  appHost: string;`,
			`  socket: {`,
			`    redirect(payload: { url: string }): void;`,
			`    on(event: string, handler: (...args: unknown[]) => void): void;`,
			`    removeAllListeners(event?: string): void;`,
			`    destroy(): void;`,
			`  };`,
			`};`,
			`type SkillParams__tool_${index} = ${inputType};`,
			`type SkillResult__tool_${index} = ${outputType};`
		].join('\n'),
		issues
	};
}

function injectParityHandlerJSDoc(code: string, index: number): string {
	const withoutLeadingJSDoc = code.replace(
		/^\s*\/\*\*[\s\S]*?\*\/\s*(?=async\s+function\s+handler\s*\()/,
		''
	);
	const match = withoutLeadingJSDoc.match(
		/async\s+function\s+handler\s*\(\s*([A-Za-z_$][A-Za-z0-9_$]*)\s*,\s*([A-Za-z_$][A-Za-z0-9_$]*)\s*\)/
	);
	const stateName = match?.[1] ?? 'state';
	const paramsName = match?.[2] ?? 'params';
	return [
		'/**',
		` * @param {SkillState__tool_${index}} ${stateName}`,
		` * @param {SkillParams__tool_${index}} ${paramsName}`,
		' */',
		withoutLeadingJSDoc.trimStart()
	].join('\n');
}

function collectDiagnostics(
	files: Map<string, string>,
	runtimeDeclarationPath: string,
	options?: { filterToSkillRoot?: string }
): SkillValidationIssue[] {
	const compilerOptions = buildCompilerOptions();
	const baseHost = ts.createCompilerHost(compilerOptions, true);
	const host: ts.CompilerHost = {
		...baseHost,
		fileExists(fileName) {
			return files.has(fileName) || baseHost.fileExists(fileName);
		},
		readFile(fileName) {
			return files.get(fileName) ?? baseHost.readFile(fileName);
		},
		getSourceFile(fileName, languageVersion) {
			const sourceText = host.readFile(fileName);
			if (sourceText == null) {
				return undefined;
			}
			return ts.createSourceFile(fileName, sourceText, languageVersion, true);
		},
		writeFile() {
			// validation only
		}
	};

	const program = ts.createProgram({
		rootNames: [...files.keys()],
		options: compilerOptions,
		host
	});

	const issues: SkillValidationIssue[] = [];
	for (const diagnostic of ts.getPreEmitDiagnostics(program)) {
		const fileName = diagnostic.file?.fileName ?? null;
		if (!fileName || !files.has(fileName) || fileName === runtimeDeclarationPath) {
			continue;
		}
		if (options?.filterToSkillRoot && !fileName.startsWith(options.filterToSkillRoot)) {
			continue;
		}
		const position =
			diagnostic.file && typeof diagnostic.start === 'number'
				? diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start)
				: null;
		const code = diagnostic.code ?? null;
		const severity: SkillValidationIssue['severity'] =
			diagnostic.category === ts.DiagnosticCategory.Warning ||
			UNUSED_DIAGNOSTIC_CODES.has(Number(code))
				? 'warning'
				: 'error';
		issues.push({
			severity,
			source: 'typescript',
			filePath: fileName,
			message: ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'),
			code,
			line: position ? position.line + 1 : null,
			column: position ? position.character + 1 : null
		});
	}
	return issues;
}

function validatePlainTypeScriptFiles(files: VirtualValidationFile[]): SkillValidationIssue[] {
	if (files.length === 0) {
		return [];
	}
	const runtimeDeclarationPath = path.posix.join('/__skill_validation__', 'runtime.d.ts');
	const normalizedFiles = new Map<string, string>();
	for (const file of files) {
		normalizedFiles.set(file.filePath, file.content);
	}
	normalizedFiles.set(runtimeDeclarationPath, skillRuntimeDeclarations);
	return collectDiagnostics(normalizedFiles, runtimeDeclarationPath);
}

function validateParityToolFile(file: VirtualValidationFile, index: number): SkillValidationIssue[] {
	const runtimeDeclarationPath = path.posix.join(
		'/__skill_validation__',
		`runtime-${index}.d.ts`
	);
	const parityEntryPath = path.posix.join('/__skill_validation__', `parity-tool-${index}.ts`);
	const { content: typeDefinitions, issues: schemaIssues } = buildParityTypeDefinitions(file, index);
	const normalizedFiles = new Map<string, string>([
		[runtimeDeclarationPath, skillRuntimeDeclarations],
		[file.filePath, injectParityHandlerJSDoc(file.content, index)],
		[
			parityEntryPath,
			[
				typeDefinitions,
				'declare const __skill_state__: SkillState__tool_' + index + ';',
				'declare const __skill_params__: SkillParams__tool_' + index + ';',
				'const __skill_result__: Promise<SkillResult__tool_' + index + '> = Promise.resolve(handler(__skill_state__, __skill_params__));',
				'void __skill_result__;'
			].join('\n')
		]
	]);
	const diagnostics = collectDiagnostics(normalizedFiles, runtimeDeclarationPath).map((issue) =>
		issue.filePath === parityEntryPath
			? {
					...issue,
					filePath: file.filePath,
					line: null,
					column: null
				}
			: issue
	);
	return [...schemaIssues, ...diagnostics];
}

export function validateTypeScriptSkillFiles(files: VirtualValidationFile[]): SkillValidationIssue[] {
	const parityIssues: SkillValidationIssue[] = [];
	const plainFiles: VirtualValidationFile[] = [];
	for (let index = 0; index < files.length; index += 1) {
		const file = files[index]!;
		if ('inputSchema' in file || 'outputSchema' in file) {
			parityIssues.push(...validateParityToolFile(file, index));
			continue;
		}
		plainFiles.push(file);
	}
	return [...parityIssues, ...validatePlainTypeScriptFiles(plainFiles)];
}

export function createPayloadValidationReport(
	skillName: string,
	files: VirtualValidationFile[],
	issues: SkillValidationIssue[],
	diagnostics?: LadcraftDeployDiagnostics
): SkillValidationReport {
	const runtimeWarnings: SkillValidationIssue[] = [];
	for (const script of diagnostics?.scripts ?? []) {
		for (const warning of script.warnings ?? []) {
			runtimeWarnings.push({
				severity: warning.level === 'warn' ? 'warning' : 'warning',
				source: warning.level === 'warn' ? 'runtime' : 'publish',
				filePath: `scripts/${script.name}.js`,
				message: warning.message,
				code: warning.code,
				line: null,
				column: null
			});
		}
	}
	for (const widget of diagnostics?.widgets ?? []) {
		for (const warning of widget.warnings ?? []) {
			runtimeWarnings.push({
				severity: warning.level === 'warn' ? 'warning' : 'warning',
				source: warning.level === 'warn' ? 'runtime' : 'publish',
				filePath: `widgets/${widget.name}.html`,
				message: warning.message,
				code: warning.code,
				line: null,
				column: null
			});
		}
	}
	return createSkillValidationReport(skillName, [
		...issues,
		...validateTypeScriptSkillFiles(files),
		...runtimeWarnings
	]);
}
