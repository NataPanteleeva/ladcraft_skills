import { existsSync } from 'node:fs';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { buildLadcraftDeployDiagnostics, hasHandlebarsBlockSyntax } from './skill-builder.js';
import { type LocalSkillPayload } from './skill-folder-reader.js';
import { readCanonicalSkillFromFolder } from './skill-folder-writer.js';

export type SkillAuditCategory =
	| 'runtime_vfs_legacy_input'
	| 'handlebars_widget'
	| 'ghost_tools'
	| 'legacy_default_capabilities'
	| 'noncanonical_skill_storage'
	| 'public_contract_legacy_wording'
	| 'diagnostic_warning';

export type SkillCompatibilityIssue = {
	severity: 'error' | 'warning';
	source: 'compatibility';
	filePath: string | null;
	message: string;
	code: string;
	category: SkillAuditCategory;
	line: number | null;
	column: number | null;
};

export type SkillCompatibilityReport = {
	skillName: string;
	issues: SkillCompatibilityIssue[];
	errors: SkillCompatibilityIssue[];
	warnings: SkillCompatibilityIssue[];
	isBlocking: boolean;
	errorCount: number;
	warningCount: number;
	summaryText: string;
	copyText: string;
	scannedAt: string | null;
};

export type SkillAuditFinding = {
	skillName: string;
	category: SkillAuditCategory;
	severity: 'error' | 'warning';
	code: string;
	message: string;
	filePath: string | null;
};

export type SkillCompatibilityAuditMeta = {
	enabled: boolean;
	reason: string | null;
	scannedAt: string | null;
	scannedSkills: number;
	isRunning: boolean;
};

export type SkillCompatibilityAuditReport = {
	enabled: boolean;
	reason: string | null;
	scannedAt: string | null;
	scannedSkills: number;
	findings: SkillAuditFinding[];
	skillReports: Record<string, SkillCompatibilityReport>;
};

function formatCompatibilityLocation(issue: SkillCompatibilityIssue): string {
	if (issue.filePath && issue.line != null && issue.column != null) {
		return `${issue.filePath}:${issue.line}:${issue.column}`;
	}
	return issue.filePath ?? 'skill';
}

function formatCompatibilityBadge(issue: SkillCompatibilityIssue): string {
	return `${issue.source} ${issue.code}`;
}

function formatCompatibilityCopyText(report: SkillCompatibilityReport): string {
	const lines = [`Skill "${report.skillName}" compatibility report`, report.summaryText];
	if (report.errors.length > 0) {
		lines.push('', 'Errors:');
		for (const issue of report.errors) {
			lines.push(
				`- [${formatCompatibilityBadge(issue)}] ${formatCompatibilityLocation(issue)} ${issue.message}`
			);
		}
	}
	if (report.warnings.length > 0) {
		lines.push('', 'Warnings:');
		for (const issue of report.warnings) {
			lines.push(
				`- [${formatCompatibilityBadge(issue)}] ${formatCompatibilityLocation(issue)} ${issue.message}`
			);
		}
	}
	return lines.join('\n');
}

function isGhostToolReference(body: string): boolean {
	return /\b(delegateToAgent|runDialog|workspace\s*\(|skills activate)\b/.test(body);
}

function hasLegacyDefaultCapabilities(payload: LocalSkillPayload): boolean {
	const mcp = payload.mcp_spec;
	const dc =
		mcp && typeof mcp.default_capabilities === 'object' && !Array.isArray(mcp.default_capabilities)
			? (mcp.default_capabilities as Record<string, unknown>)
			: null;
	const required = Array.isArray(dc?.required) ? dc.required : [];
	return required.some((item) => {
		if (!item || typeof item !== 'object' || Array.isArray(item)) return false;
		const record = item as Record<string, unknown>;
		const type = typeof record.type === 'string' ? record.type.trim() : '';
		if (type === 'vfs.workspace' || type === 'storage.kv') return true;
		const ops = Array.isArray(record.operations)
			? record.operations.filter((entry): entry is string => typeof entry === 'string')
			: [];
		return (
			type === 'vfs' &&
			ops.some((operation) => ['read', 'write', 'list', 'delete'].includes(operation.trim().toLowerCase()))
		);
	});
}

function getAuditDir(skillsRootPath: string): string {
	return path.join(skillsRootPath, '.audit');
}

export function getAuditJsonPath(skillsRootPath: string): string {
	return path.join(getAuditDir(skillsRootPath), 'builder-audit.json');
}

export function getAuditMarkdownPath(skillsRootPath: string): string {
	return path.join(getAuditDir(skillsRootPath), 'builder-audit.md');
}

function isSkillFindingVisibleInUi(finding: SkillAuditFinding): boolean {
	return (
		finding.skillName.trim().length > 0 &&
		finding.skillName !== '[public-contract]' &&
		finding.category !== 'noncanonical_skill_storage' &&
		finding.category !== 'public_contract_legacy_wording'
	);
}

function buildSkillCompatibilityReport(
	skillName: string,
	findings: SkillAuditFinding[],
	scannedAt: string | null
): SkillCompatibilityReport {
	const issues = findings
		.filter((finding) => finding.skillName === skillName && isSkillFindingVisibleInUi(finding))
		.map<SkillCompatibilityIssue>((finding) => ({
			severity: finding.severity,
			source: 'compatibility',
			filePath: finding.filePath,
			message: finding.message,
			code: finding.code,
			category: finding.category,
			line: null,
			column: null
		}));
	const errors = issues.filter((issue) => issue.severity === 'error');
	const warnings = issues.filter((issue) => issue.severity === 'warning');
	const summaryText = `Errors: ${errors.length}, warnings: ${warnings.length}`;
	const base: SkillCompatibilityReport = {
		skillName,
		issues,
		errors,
		warnings,
		isBlocking: errors.length > 0,
		errorCount: errors.length,
		warningCount: warnings.length,
		summaryText,
		copyText: '',
		scannedAt
	};
	return {
		...base,
		copyText: formatCompatibilityCopyText(base)
	};
}

function buildSkillReports(
	findings: SkillAuditFinding[],
	scannedAt: string | null
): Record<string, SkillCompatibilityReport> {
	const skillNames = [...new Set(findings.map((finding) => finding.skillName).filter((name) => name.trim()))]
		.filter((name) => name !== '[public-contract]')
		.sort((left, right) => left.localeCompare(right));
	return Object.fromEntries(
		skillNames.map((skillName) => [skillName, buildSkillCompatibilityReport(skillName, findings, scannedAt)])
	);
}

function buildMarkdown(report: SkillCompatibilityAuditReport): string {
	const grouped = new Map<string, SkillAuditFinding[]>();
	for (const finding of report.findings) {
		const list = grouped.get(finding.skillName) ?? [];
		list.push(finding);
		grouped.set(finding.skillName, list);
	}
	const categories = report.findings.reduce<Record<string, number>>((acc, finding) => {
		acc[finding.category] = (acc[finding.category] ?? 0) + 1;
		return acc;
	}, {});
	const summaryLines = Object.entries(categories)
		.sort(([left], [right]) => left.localeCompare(right))
		.map(([category, count]) => `- \`${category}\`: ${count}`)
		.join('\n');
	const perSkill = [...grouped.entries()]
		.sort(([left], [right]) => left.localeCompare(right))
		.map(([skillName, items]) => {
			const lines = items
				.map((item) => {
					const filePart = item.filePath ? ` ${item.filePath}` : '';
					return `- [${item.category}] (${item.code})${filePart}: ${item.message}`;
				})
				.join('\n');
			return `## ${skillName}\n${lines}`;
		})
		.join('\n\n');
	return [
		'# Builder Audit',
		'',
		`Enabled: ${report.enabled ? 'yes' : 'no'}`,
		`Scanned at: ${report.scannedAt ?? 'not-run'}`,
		`Scanned skills: ${report.scannedSkills}`,
		`Findings: ${report.findings.length}`,
		...(report.reason ? ['', `Reason: ${report.reason}`] : []),
		'',
		'## Summary by Category',
		summaryLines || '- none',
		'',
		'## Findings by Skill',
		perSkill || 'No findings.'
	].join('\n');
}

async function listSkillFolders(root: string): Promise<string[]> {
	const entries = await readdir(root, { withFileTypes: true }).catch(() => []);
	return entries
		.filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
		.map((entry) => path.join(root, entry.name))
		.sort((left, right) => left.localeCompare(right));
}

async function readWidgetTemplates(skillPath: string): Promise<Array<{ name: string; content: string }>> {
	const widgetsDir = path.join(skillPath, 'widgets');
	try {
		const entries = await readdir(widgetsDir, { withFileTypes: true });
		const widgets: Array<{ name: string; content: string }> = [];
		for (const entry of entries) {
			if (!entry.isFile() || !/\.(md|MD)$/.test(entry.name)) continue;
			const content = await readFile(path.join(widgetsDir, entry.name), 'utf-8');
			widgets.push({ name: entry.name, content });
		}
		return widgets;
	} catch {
		return [];
	}
}

async function auditSkill(skillPath: string): Promise<SkillAuditFinding[]> {
	const canonical = await readCanonicalSkillFromFolder(skillPath);
	const payload = canonical.payload;
	const findings: SkillAuditFinding[] = [];
	if (canonical.changed) {
		findings.push({
			skillName: payload.name,
			category: 'noncanonical_skill_storage',
			severity: 'warning',
			code: 'noncanonical-skill-storage',
			filePath: path.relative(skillPath, skillPath) || 'SKILL.md',
			message:
				canonical.backupPath != null
					? `Skill folder normalized to canonical handler format; backup created at ${canonical.backupPath}`
					: 'Skill folder normalized to canonical handler format.'
		});
	}
	const diagnostics = buildLadcraftDeployDiagnostics(payload);
	for (const script of diagnostics.scripts) {
		for (const warning of script.warnings) {
			if (warning.level === 'info') continue;
			findings.push({
				skillName: payload.name,
				category:
					warning.code === 'legacy-runtime-vfs-methods'
						? 'runtime_vfs_legacy_input'
						: 'diagnostic_warning',
				severity: warning.level === 'error' ? 'error' : 'warning',
				code: warning.code,
				filePath: path.join('scripts', `${script.name}.js`),
				message: warning.message
			});
		}
	}
	const widgetTemplates = await readWidgetTemplates(skillPath);
	for (const widget of widgetTemplates) {
		if (!hasHandlebarsBlockSyntax(widget.content)) continue;
		findings.push({
			skillName: payload.name,
			category: 'handlebars_widget',
			severity: 'warning',
			code: 'widget-handlebars-block-syntax',
			filePath: path.join('widgets', widget.name),
			message: `${widget.name}: uses Handlebars block syntax`
		});
	}
	if (isGhostToolReference(payload.body)) {
		findings.push({
			skillName: payload.name,
			category: 'ghost_tools',
			severity: 'warning',
			code: 'ghost-tools',
			filePath: 'SKILL.md',
			message: 'Prompt references ghost/runtime tools outside the local package contract.'
		});
	}
	if (hasLegacyDefaultCapabilities(payload)) {
		findings.push({
			skillName: payload.name,
			category: 'legacy_default_capabilities',
			severity: 'warning',
			code: 'legacy-default-capabilities',
			filePath: 'SKILL.md',
			message: 'default_capabilities contains legacy types or non-runtime operation names.'
		});
	}
	return findings;
}

async function auditPublicContractDocs(cursorLadcraftRoot: string): Promise<SkillAuditFinding[]> {
	const checks: Array<{ filePath: string; pattern: RegExp; message: string; code: string }> = [
		{
			filePath: path.join(cursorLadcraftRoot, 'README.md'),
			pattern: /docs\/legacy\//,
			message: 'README still references removed docs/legacy bundle.',
			code: 'readme-legacy-docs-reference'
		},
		{
			filePath: path.join(cursorLadcraftRoot, 'mcp_instructions.md'),
			pattern: /docs\/legacy\//,
			message: 'mcp_instructions still references removed docs/legacy bundle.',
			code: 'mcp-instructions-legacy-docs-reference'
		},
		{
			filePath: path.join(cursorLadcraftRoot, 'dev-server', 'README.md'),
			pattern: /local-style code \(server-side\)/i,
			message: 'dev-server README still presents local-style as current script format.',
			code: 'dev-server-readme-legacy-wording'
		}
	];
	const findings: SkillAuditFinding[] = [];
	for (const check of checks) {
		const content = await readFile(check.filePath, 'utf-8').catch(() => '');
		if (!content || !check.pattern.test(content)) continue;
		findings.push({
			skillName: '[public-contract]',
			category: 'public_contract_legacy_wording',
			severity: 'error',
			code: check.code,
			filePath: path.relative(cursorLadcraftRoot, check.filePath),
			message: check.message
		});
	}
	return findings;
}

export async function generateCompatibilityAuditReport(params: {
	skillsRootPath: string;
	cursorLadcraftRoot: string;
}): Promise<SkillCompatibilityAuditReport> {
	const normalizedRoot = params.skillsRootPath.trim();
	if (!normalizedRoot) {
		return {
			enabled: false,
			reason: 'Skills root is not configured.',
			scannedAt: null,
			scannedSkills: 0,
			findings: [],
			skillReports: {}
		};
	}
	const skillFolders = await listSkillFolders(normalizedRoot);
	const findings: SkillAuditFinding[] = await auditPublicContractDocs(params.cursorLadcraftRoot);
	for (const skillPath of skillFolders) {
		findings.push(...(await auditSkill(skillPath)));
	}
	const scannedAt = new Date().toISOString();
	return {
		enabled: true,
		reason: null,
		scannedAt,
		scannedSkills: skillFolders.length,
		findings,
		skillReports: buildSkillReports(findings, scannedAt)
	};
}

export async function writeCompatibilityAuditReport(
	skillsRootPath: string,
	report: SkillCompatibilityAuditReport
): Promise<void> {
	if (!skillsRootPath.trim() || !report.enabled) {
		return;
	}
	const auditDir = getAuditDir(skillsRootPath);
	await mkdir(auditDir, { recursive: true });
	await writeFile(getAuditJsonPath(skillsRootPath), `${JSON.stringify(report, null, 2)}\n`, 'utf-8');
	await writeFile(getAuditMarkdownPath(skillsRootPath), `${buildMarkdown(report)}\n`, 'utf-8');
}

export async function readCompatibilityAuditReport(
	skillsRootPath: string
): Promise<SkillCompatibilityAuditReport | null> {
	if (!skillsRootPath.trim()) return null;
	const jsonPath = getAuditJsonPath(skillsRootPath);
	if (!existsSync(jsonPath)) return null;
	try {
		return JSON.parse(await readFile(jsonPath, 'utf-8')) as SkillCompatibilityAuditReport;
	} catch {
		return null;
	}
}

export function buildCompatibilityAuditMeta(params: {
	report: SkillCompatibilityAuditReport | null;
	isRunning: boolean;
	reason?: string | null;
}): SkillCompatibilityAuditMeta {
	return {
		enabled: params.report?.enabled ?? false,
		reason: params.report?.reason ?? params.reason ?? null,
		scannedAt: params.report?.scannedAt ?? null,
		scannedSkills: params.report?.scannedSkills ?? 0,
		isRunning: params.isRunning
	};
}

export class CompatibilityAuditManager {
	private activeRun: Promise<SkillCompatibilityAuditReport> | null = null;
	private pendingRun = false;
	private lastReport: SkillCompatibilityAuditReport | null = null;

	constructor(
		private readonly options: {
			skillsRootPath: string;
			cursorLadcraftRoot: string;
		}
	) {}

	getCachedReport(): SkillCompatibilityAuditReport | null {
		return this.lastReport;
	}

	isRunning(): boolean {
		return this.activeRun != null;
	}

	getSkillReport(skillName: string): SkillCompatibilityReport | null {
		return this.lastReport?.skillReports?.[skillName] ?? null;
	}

	schedule(): void {
		this.pendingRun = true;
		void this.startRunLoop();
	}

	async ensureFresh(): Promise<SkillCompatibilityAuditReport> {
		this.pendingRun = true;
		return this.startRunLoop();
	}

	private async startRunLoop(): Promise<SkillCompatibilityAuditReport> {
		if (this.activeRun) {
			return this.activeRun;
		}
		this.activeRun = (async () => {
			let latest: SkillCompatibilityAuditReport = this.lastReport ?? {
				enabled: false,
				reason: 'Audit has not been executed yet.',
				scannedAt: null,
				scannedSkills: 0,
				findings: [],
				skillReports: {}
			};
			do {
				this.pendingRun = false;
				latest = await generateCompatibilityAuditReport(this.options);
				await writeCompatibilityAuditReport(this.options.skillsRootPath, latest);
				this.lastReport = latest;
			} while (this.pendingRun);
			return latest;
		})().finally(() => {
			this.activeRun = null;
		});
		return this.activeRun;
	}
}
