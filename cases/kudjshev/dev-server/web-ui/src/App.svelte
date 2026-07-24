<script lang="ts">
	// BUNDLE_MARKER v0.1.1 — prod smoke (web-ui)
	import { onMount, tick } from 'svelte';
	import SchemaFormField from './SchemaFormField.svelte';

	type LocalSkillMeta = {
		name: string;
		description: string;
		scriptsCount: number;
		widgetsCount: number;
		updatedAt: string;
		fileName: string;
		filePath: string;
		isFromServer?: boolean;
		serverSkillId?: string;
		identityKey: string;
		hasCompatibilityIssues?: boolean;
		compatibilitySummary?: {
			errorCount: number;
			warningCount: number;
			isBlocking: boolean;
			summaryText: string;
			scannedAt: string | null;
		} | null;
	};

	type SkillScript = {
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

	type SkillPayload = {
		name: string;
		description: string;
		body: string;
		scripts: SkillScript[];
		widgets: Array<Record<string, unknown>>;
		mcp_spec: Record<string, unknown> | null;
	};

	type SkillValidationIssue = {
		severity: 'error' | 'warning';
		source: 'typescript' | 'structure' | 'runtime' | 'publish';
		filePath: string | null;
		message: string;
		code: string | number | null;
		line: number | null;
		column: number | null;
	};

	type SkillValidationReport = {
		skillName: string;
		issues: SkillValidationIssue[];
		errors: SkillValidationIssue[];
		warnings: SkillValidationIssue[];
		isBlocking: boolean;
		summaryText: string;
		copyText: string;
		chatText: string;
	};

	type SkillCompatibilityIssue = {
		severity: 'error' | 'warning';
		source: 'compatibility';
		filePath: string | null;
		message: string;
		code: string;
		category: string;
		line: number | null;
		column: number | null;
	};

	type SkillCompatibilityReport = {
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

	type SkillCompatibilityAuditMeta = {
		enabled: boolean;
		reason: string | null;
		scannedAt: string | null;
		scannedSkills: number;
		isRunning: boolean;
	};

	type DeployPreflight = {
		currentVersion: string;
		targetAction: 'create' | 'update' | 'upsert';
		applicationId: string | null;
		validation: { errors: string[]; warnings: string[] };
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
		bumpType?: 'patch' | 'minor' | 'major';
		reason?: string;
		fromVersion: string;
		toVersion?: string;
		applicationId: string | null;
		installedApplicationId: string | null;
		autoInstallStatus: 'updated' | 'installed' | 'skipped' | 'failed' | null;
		status: 'success' | 'failed' | 'conflict' | 'dry_run';
		error: string | null;
	};

	type LadcraftEnvironment = 'dev' | 'prod';

	type BundleUpdateStatus = {
		state: 'idle' | 'running' | 'success' | 'failed';
		mode: 'update' | 'rollback' | null;
		stage:
			| 'idle'
			| 'starting'
			| 'downloading'
			| 'unpacking'
			| 'backing_up'
			| 'applying'
			| 'restarting'
			| 'completed'
			| 'failed'
			| 'rollback_starting'
			| 'rollback_applying'
			| 'rolled_back';
		message: string;
		runId: string | null;
		startedAt: string | null;
		finishedAt: string | null;
		currentVersion: string | null;
		targetVersion: string | null;
		backupPath: string | null;
		lastError: string | null;
		preserveSkills: boolean;
		updatedAt: string;
	};

	type HealthInfo = {
		hasSkilledAgentToken?: boolean;
		hasPrototypeToken?: boolean;
		ladcraftEnv?: LadcraftEnvironment;
		ladcraftApiBaseUrl?: string;
		ladcraftReauthUrl?: string;
		authStatuses?: Partial<Record<LadcraftEnvironment, boolean>>;
		ladcraftTokenRefreshHint?: string;
		prototypeTokenWarning?: string | null;
		cursorLadcraftBundleVersion?: string | null;
		remoteCursorLadcraftBundleVersion?: string | null;
		cursorLadcraftBundleOutdated?: boolean;
		cursorLadcraftBundleVersionError?: string | null;
		bundleUpdateStatus?: BundleUpdateStatus;
	};

	// В dev Vite проксирует /api на API-сервер; в production задайте VITE_API_BASE_URL
	const apiBase =
		import.meta.env.VITE_API_BASE_URL ?? (import.meta.env.DEV ? '' : 'http://localhost:4321');
	const requestTimeoutMs = 12000;

	/** Стор состояния редактора по имени навыка (при переключении навыков/деплое/загрузке не теряется). */
	type SkillEditorState = {
		formName: string;
		formDescription: string;
		formBody: string;
		scriptsJson: string;
		widgetsJson: string;
		mcpSpecJson: string;
		selectedScriptName: string;
		scriptInputData: Record<string, unknown>;
		scriptInputJson: string;
		/** Ввод параметров по каждому скрипту (чтобы при переключении A → B → A данные A не терялись). */
		scriptInputByScript?: Record<
			string,
			{ scriptInputData: Record<string, unknown>; scriptInputJson: string }
		>;
	};
	const skillStateStore: Record<string, SkillEditorState> = {};

	let localSkills = $state<LocalSkillMeta[]>([]);
	let prototypeSkills = $state<LocalSkillMeta[]>([]);
	let remoteSkills = $state<Array<{ id: string; name: string; identityKey?: string }>>([]);
	/** Метаданные с сервера после «Обновить список»: identityKey -> { id, hasConflict }. */
	let remoteSkillsMeta = $state<Record<string, { id: string; hasConflict: boolean }>>({});
	/** Навыки, для которых пользователь выбрал «Сохранить мои» — не показывать конфликт до следующей загрузки. */
	let conflictDismissed = $state<Set<string>>(new Set());
	let showDeployAfterKeepLocal = $state(false);

	let selectedSkillName = $state('');
	let selectedSkillSource = $state<'ladcraft' | 'prototype'>('ladcraft');
	let activeSkillListTab = $state<'ladcraft' | 'prototype'>('ladcraft');
	let previousSkillName = $state<string | null>(null);

	let formName = $state('');
	let formDescription = $state('');
	let formBody = $state('');
	let scriptsJson = $state('[]');
	let widgetsJson = $state('[]');
	let mcpSpecJson = $state('{}');

	let selectedScriptName = $state('');
	/** Единый источник истины для параметров скрипта (input). Форма и JSON-редактор синхронизируются с ним. */
	let scriptInputData = $state<Record<string, unknown>>({});
	/** Строка для отображения в «Редактор JSON»; синхронизируется с scriptInputData при изменении формы; при blur парсится обратно в scriptInputData. */
	let scriptInputJson = $state('{}');
	let remoteUpdateSkillId = $state('');

	let localListLoading = $state(false);
	let prototypeListLoading = $state(false);
	let localSkillLoading = $state(false);
	let prototypeSkillLoading = $state(false);
	let remoteListLoading = $state(false);
	let syncPrototypeLoading = $state(false);
	let copyPrototypeLoading = $state(false);
	let downloadFromServerLoading = $state(false);
	let bundleUpdateStarting = $state(false);
	let bundleUpdateError = $state('');
	let bundleUpdateStatus = $state<BundleUpdateStatus | null>(null);
	let saveSkillLoading = $state(false);
	let runScriptLoading = $state(false);
	let deleteSkillLoading = $state(false);
	let outputDetailsOpen = $state(false);
	let refreshingListsAfterDeploy = $state(false);
	let output = $state('');
	let logs = $state<string[]>([]);
	let widgetHtml = $state('');
	let widgetName = $state('');
	let activeTab = $state<'test' | 'advanced'>('advanced');
	let deployResult = $state<unknown>(null);
	let deployError = $state('');
	let deployPreflightLoading = $state(false);
	let deployPreflight = $state<DeployPreflight | null>(null);
	let deployValidationCopying = $state(false);
	let compatibilityReport = $state<SkillCompatibilityReport | null>(null);
	let compatibilityAuditMeta = $state<SkillCompatibilityAuditMeta | null>(null);
	let compatibilityCopying = $state(false);
	let remotePublishedVersion = $state<string | null>(null);
	let deployHistoryLoading = $state(false);
	let deployHistory = $state<DeployHistoryEntry[]>([]);
	let replayDeployLoading = $state(false);
	let postDeployCheckLoading = $state(false);
	let postDeployCheck = $state<{
		summary: { ok: number; warn: number; fail: number };
		checks: Array<{ id: string; status: 'ok' | 'warn' | 'fail'; message: string }>;
	} | null>(null);
	let healthInfo = $state<HealthInfo | null>(null);
	let remoteAuthExpired = $state(false);
	let authPanelOpen = $state(false);
	let faqModalOpen = $state(false);
	let authEmail = $state('');
	let authPassword = $state('');
	let authLoginLoading = $state(false);
	let authLoginError = $state('');
	let manualToken = $state('');
	let manualTokenUpdating = $state(false);
	let manualTokenError = $state('');
	let authLogoutLoadingEnv = $state<LadcraftEnvironment | null>(null);
	let authLogoutError = $state('');
	let authFailureModalTitle = $state('Ошибка авторизации');
	let authFailureModalMessage = $state<string | null>(null);
	let envSwitching = $state(false);
	let listLoadError = $state('');
	let prototypeListLoadError = $state('');
	let remoteSkillsLoadError = $state('');
	let deployModalOpen = $state(false);
	let existingSkillForDeploy = $state<{ id: string; name: string } | null>(null);
	let deployCreateNewNameVisible = $state(false);
	let deployCreateNewName = $state('');
	let widgetPreviewExpanded = $state(false);
	let widgetFullscreenBackdropEl = $state<HTMLDivElement | null>(null);
	let deploySending = $state(false);
	let sendDebounceTimerId: number | null = null;
	let deleteConfirmSkillName = $state<string | null>(null);

	let sseConnected = $state(false);
	let localSkillsPollTimer: number | null = null;
	let bundleUpdatePollTimer: number | null = null;
	let skillsEventSource: EventSource | null = null;
	let quietLocalListInFlight = false;
	let pendingQuietLocalList = false;
	let quietPrototypeListInFlight = false;
	let pendingQuietPrototypeList = false;
	let installEnvDraftSaveTimerId: number | null = null;
	let mcpSpecDraftSaveTimerId: number | null = null;
	const MCP_SPEC_DRAFTS_STORAGE_KEY = 'cursor_ladcraft_mcp_spec_drafts_v1';

	type InstallationFormValue = string | number | boolean;
	type InstallationFormByTool = Record<string, Record<string, InstallationFormValue>>;
	type InstallEnvField = { toolName: string; key: string; title: string; format: string };
	type MergedInstallEnvField = {
		key: string;
		title: string;
		format: string;
		toolNames: string[];
		hasMixedTitle: boolean;
		hasMixedFormat: boolean;
	};
	type McpUserEnvRow = { key: string; title: string; format: string };
	type McpAppEnvRow = { key: string; value: string };
	type McpEnvironmentByTool = {
		toolName: string;
		userRows: McpUserEnvRow[];
		appRows: McpAppEnvRow[];
	};
	type MergedUserEnvRow = {
		key: string;
		title: string;
		format: string;
		toolNames: string[];
		hasMixedTitle: boolean;
		hasMixedFormat: boolean;
	};
	type MergedAppEnvRow = {
		key: string;
		value: string;
		toolNames: string[];
		hasMixedValues: boolean;
	};
	type CapabilityRequirementRow = {
		type: string;
		operations: string[];
		scope: string;
	};
	type CapabilityCatalogItem = {
		type: string;
	label?: string;
	description?: string;
		operations: string[];
	operation_descriptions?: Record<string, string>;
		scopes: string[];
	};
	let installEnvModalOpen = $state(false);
	let installEnvFields = $state<InstallEnvField[]>([]);
	let installEnvValues = $state<Record<string, string>>({});
	let installEnvError = $state('');
	let installEnvCallback = $state<((form: InstallationFormByTool) => void) | null>(null);
	let capabilityCatalog = $state<CapabilityCatalogItem[]>([]);
let capabilityCatalogSource = $state<'api' | null>(null);
	let capabilityCatalogWarning = $state('');
	let capabilityCatalogLoading = $state(false);
	const installEnvMergedFields = $derived.by(() => {
		const grouped = new Map<string, MergedInstallEnvField>();
		for (const field of installEnvFields) {
			const existing = grouped.get(field.key);
			if (!existing) {
				grouped.set(field.key, {
					key: field.key,
					title: field.title,
					format: field.format,
					toolNames: [field.toolName],
					hasMixedTitle: false,
					hasMixedFormat: false
				});
				continue;
			}
			if (!existing.toolNames.includes(field.toolName)) existing.toolNames.push(field.toolName);
			if (existing.title !== field.title) existing.hasMixedTitle = true;
			if (existing.format !== field.format) existing.hasMixedFormat = true;
		}
		return Array.from(grouped.values()).sort((a, b) => a.key.localeCompare(b.key));
	});

	const mcpEnvironmentByTool = $derived(listMcpEnvironmentByTool());
	const hasMcpUserEnv = $derived(mcpEnvironmentByTool.some((tool) => tool.userRows.length > 0));
	const hasMcpAppEnv = $derived(mcpEnvironmentByTool.some((tool) => tool.appRows.length > 0));
	const mcpDefaultCapabilities = $derived(listMcpDefaultCapabilities());

	function skillIdentityKey(skill: {
		identityKey?: string;
		name: string;
		serverSkillId?: string;
	}): string {
		if (skill.identityKey) return skill.identityKey;
		if (typeof skill.serverSkillId === 'string' && skill.serverSkillId.trim().length > 0)
			return `server:${skill.serverSkillId}`;
		return `name:${skill.name}`;
	}

	function selectedLocalSkillMeta(): LocalSkillMeta | null {
		return localSkills.find((skill) => skill.name === selectedSkillName) ?? null;
	}

	function hasCompatibilityIssuesForSkill(skill: LocalSkillMeta): boolean {
		return skill.hasCompatibilityIssues === true;
	}

	function selectedSkillCompatibilitySummary():
		| NonNullable<LocalSkillMeta['compatibilitySummary']>
		| null {
		return selectedLocalSkillMeta()?.compatibilitySummary ?? null;
	}

	function isPrototypeSkillSelected(): boolean {
		return selectedSkillSource === 'prototype';
	}

	function hasRemoteVersionForSkill(skill: LocalSkillMeta): boolean {
		const key = skillIdentityKey(skill);
		return Boolean(remoteSkillsMeta[key]);
	}

	function hasConflictForSkill(skill: LocalSkillMeta): boolean {
		const key = skillIdentityKey(skill);
		const meta = remoteSkillsMeta[key];
		return !!(meta?.hasConflict && !conflictDismissed.has(key));
	}

	function selectedSkillHasConflict(): boolean {
		if (isPrototypeSkillSelected()) return false;
		const selected = selectedLocalSkillMeta();
		return selected ? hasConflictForSkill(selected) : false;
	}

	/** Список имён локальных навыков, у которых есть конфликт с сервером (для глобального баннера). */
	function skillsWithConflicts(): string[] {
		return localSkills.filter((s) => hasConflictForSkill(s)).map((s) => s.name);
	}

	function parseJson<T>(value: string, label: string): T {
		try {
			return JSON.parse(value) as T;
		} catch (err) {
			throw new Error(
				`${label}: ожидается валидный JSON (${err instanceof Error ? err.message : 'ошибка парсинга'})`
			);
		}
	}

	function parseScriptsOrEmpty(): SkillScript[] {
		try {
			const scripts = parseJson<SkillScript[]>(scriptsJson, 'Скрипты');
			return Array.isArray(scripts) ? scripts : [];
		} catch {
			return [];
		}
	}

	function updateScriptByName(scriptName: string, updater: (script: SkillScript) => SkillScript): void {
		const scripts = parseScriptsOrEmpty();
		const idx = scripts.findIndex((script) => script.name === scriptName);
		if (idx < 0) return;
		const next = [...scripts];
		next[idx] = updater(next[idx]);
		scriptsJson = JSON.stringify(next, null, 2);
	}

	function scriptResourcesForEditor(script: SkillScript | null): {
		cpu: string;
		gpu: string;
		memory: string;
		timeout: string;
		networkHosts: string;
	} {
		const resources = script?.resources ?? {};
		const hosts = Array.isArray(resources.network?.hosts) ? resources.network.hosts : [];
		return {
			cpu: typeof resources.cpu === 'number' ? String(resources.cpu) : '',
			gpu: typeof resources.gpu === 'number' ? String(resources.gpu) : '',
			memory: typeof resources.memory === 'number' ? String(resources.memory) : '',
			timeout: typeof resources.timeout === 'number' ? String(resources.timeout) : '',
			networkHosts: hosts.join('\n')
		};
	}

	function updateSelectedScriptResourceNumber(
		resourceKey: 'cpu' | 'gpu' | 'memory' | 'timeout',
		rawValue: string
	): void {
		const scriptName = selectedScriptName;
		if (!scriptName) return;
		updateScriptByName(scriptName, (script) => {
			const baseResources = script.resources ?? {};
			const nextResources: SkillScript['resources'] = { ...baseResources };
			const trimmed = rawValue.trim();
			if (!trimmed) {
				delete nextResources[resourceKey];
			} else {
				const parsed = Number(trimmed);
				if (!Number.isFinite(parsed)) return script;
				nextResources[resourceKey] = parsed;
			}
			const hasAnyResourceField =
				typeof nextResources.cpu === 'number' ||
				typeof nextResources.gpu === 'number' ||
				typeof nextResources.memory === 'number' ||
				typeof nextResources.timeout === 'number' ||
				(Array.isArray(nextResources.network?.hosts) && nextResources.network.hosts.length > 0);
			return hasAnyResourceField ? { ...script, resources: nextResources } : { ...script, resources: undefined };
		});
	}

	function updateSelectedScriptNetworkHosts(rawValue: string): void {
		const scriptName = selectedScriptName;
		if (!scriptName) return;
		updateScriptByName(scriptName, (script) => {
			const hosts = rawValue
				.split(/\r?\n|,/)
				.map((item) => item.trim())
				.filter(Boolean);
			const baseResources = script.resources ?? {};
			const nextResources: SkillScript['resources'] = { ...baseResources };
			if (hosts.length > 0) {
				nextResources.network = { hosts };
			} else {
				delete nextResources.network;
			}
			const hasAnyResourceField =
				typeof nextResources.cpu === 'number' ||
				typeof nextResources.gpu === 'number' ||
				typeof nextResources.memory === 'number' ||
				typeof nextResources.timeout === 'number' ||
				(Array.isArray(nextResources.network?.hosts) && nextResources.network.hosts.length > 0);
			return hasAnyResourceField ? { ...script, resources: nextResources } : { ...script, resources: undefined };
		});
	}

	function currentMcpSpecObject(): Record<string, unknown> | null {
		try {
			const o = parseJson<Record<string, unknown>>(mcpSpecJson, 'MCP Spec');
			return Object.keys(o).length > 0 ? o : null;
		} catch {
			return null;
		}
	}

	function loadMcpSpecDraftsFromStorage(): Record<string, Record<string, unknown>> {
		try {
			const raw = localStorage.getItem(MCP_SPEC_DRAFTS_STORAGE_KEY);
			if (!raw) return {};
			const parsed = JSON.parse(raw);
			if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
			return parsed as Record<string, Record<string, unknown>>;
		} catch {
			return {};
		}
	}

	function saveMcpSpecDraftsToStorage(drafts: Record<string, Record<string, unknown>>): void {
		try {
			localStorage.setItem(MCP_SPEC_DRAFTS_STORAGE_KEY, JSON.stringify(drafts));
		} catch {
			// Ignore storage errors (quota/private mode), UX should continue working.
		}
	}

	function persistCurrentMcpSpecDraft(skillName: string): void {
		const key = skillName.trim();
		if (!key) return;
		const draft = currentMcpSpecObject() ?? {};
		const drafts = loadMcpSpecDraftsFromStorage();
		drafts[key] = draft;
		saveMcpSpecDraftsToStorage(drafts);
	}

	function scheduleMcpSpecDraftPersist(skillName: string): void {
		const key = skillName.trim();
		if (!key) return;
		if (mcpSpecDraftSaveTimerId) clearTimeout(mcpSpecDraftSaveTimerId);
		mcpSpecDraftSaveTimerId = window.setTimeout(() => {
			mcpSpecDraftSaveTimerId = null;
			persistCurrentMcpSpecDraft(key);
		}, 250);
	}

	function applyPersistedMcpSpecDraft(skillName: string): void {
		const key = skillName.trim();
		if (!key) return;
		const drafts = loadMcpSpecDraftsFromStorage();
		const draft = drafts[key];
		if (!draft || typeof draft !== 'object' || Array.isArray(draft)) return;
		mcpSpecJson = JSON.stringify(draft, null, 2);
	}

	function canonicalCapabilityType(type: string): string {
		const trimmed = type.trim();
		if (trimmed === 'vfs.workspace') return 'vfs';
		if (trimmed === 'storage.kv') return 'key-value-storage';
		return trimmed;
	}

	function canonicalCapabilityOperation(type: string, operation: string): string {
		const normalizedType = canonicalCapabilityType(type);
		const trimmed = operation.trim();
		if (!trimmed) return '';
		const fromCatalog = capabilityCatalog.find((item) => item.type === normalizedType);
		const catalogOperations = fromCatalog?.operations ?? [];
		const exactCatalogMatch = catalogOperations.find((item) => item === trimmed);
		if (exactCatalogMatch) return exactCatalogMatch;
		const lower = trimmed.toLowerCase();
		const caseInsensitiveMatch = catalogOperations.find((item) => item.toLowerCase() === lower);
		if (caseInsensitiveMatch) return caseInsensitiveMatch;
		if (normalizedType === 'vfs') {
			const map: Record<string, string> = {
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
			return map[lower] ?? trimmed;
		}
		if (normalizedType === 'key-value-storage') {
			if (lower === 'get') return 'Get';
			if (lower === 'set') return 'Set';
		}
		return trimmed;
	}

	function listMcpDefaultCapabilities(): CapabilityRequirementRow[] {
		const mcp = currentMcpSpecObject();
		if (!mcp) return [];
		const defaultCaps =
			mcp.default_capabilities && typeof mcp.default_capabilities === 'object'
				? (mcp.default_capabilities as Record<string, unknown>)
				: null;
		const required = Array.isArray(defaultCaps?.required) ? defaultCaps.required : [];
		const out: CapabilityRequirementRow[] = [];
		for (const raw of required) {
			if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue;
			const record = raw as Record<string, unknown>;
			const type = typeof record.type === 'string' ? canonicalCapabilityType(record.type) : '';
			if (!type) continue;
			const operations = Array.isArray(record.operations)
				? record.operations
						.filter((op): op is string => typeof op === 'string')
						.map((op) => canonicalCapabilityOperation(type, op))
						.filter(Boolean)
				: [];
			const scope =
				typeof record.scope === 'string' && record.scope.trim().length > 0
					? record.scope.trim()
					: '$USER';
			out.push({ type, operations, scope });
		}
		return out;
	}

	function updateMcpDefaultCapabilities(nextRows: CapabilityRequirementRow[]): void {
		const mcp = currentMcpSpecObject() ?? {};
		const sanitized = nextRows
			.map((row) => ({
				type: canonicalCapabilityType(row.type),
				operations: row.operations
					.map((op) => canonicalCapabilityOperation(row.type, op))
					.filter(Boolean),
				scope: row.scope.trim() || '$USER'
			}))
			.filter((row) => row.type.length > 0);
		const next: Record<string, unknown> = { ...mcp };
		if (sanitized.length > 0) {
			next.default_capabilities = { required: sanitized };
		} else {
			delete next.default_capabilities;
		}
		updateMcpSpecObject(next);
	}

	function updateCapabilityType(index: number, type: string): void {
		const rows = listMcpDefaultCapabilities();
		if (index < 0 || index >= rows.length) return;
	const nextType = canonicalCapabilityType(type);
	const nextScopes = scopesForType(nextType);
	rows[index] = {
		...rows[index],
		type: nextType,
		operations: [],
		scope: nextScopes[0] ?? '$USER'
	};
		updateMcpDefaultCapabilities(rows);
	}

	function updateCapabilityScope(index: number, scope: string): void {
		const rows = listMcpDefaultCapabilities();
		if (index < 0 || index >= rows.length) return;
		rows[index] = { ...rows[index], scope: scope.trim() || '$USER' };
		updateMcpDefaultCapabilities(rows);
	}

function setCapabilityOperationSelected(index: number, operation: string, checked: boolean): void {
		const rows = listMcpDefaultCapabilities();
		if (index < 0 || index >= rows.length) return;
	const canonicalOp = canonicalCapabilityOperation(rows[index].type, operation);
	const current = new Set(rows[index].operations);
	if (checked) current.add(canonicalOp);
	else current.delete(canonicalOp);
	const operations = [...current];
		rows[index] = { ...rows[index], operations };
		updateMcpDefaultCapabilities(rows);
	}

function operationSelected(index: number, operation: string): boolean {
	const rows = listMcpDefaultCapabilities();
	if (index < 0 || index >= rows.length) return false;
	return rows[index].operations.includes(operation);
}

function addCapabilityOperation(index: number, operation: string): void {
	const rows = listMcpDefaultCapabilities();
	if (index < 0 || index >= rows.length) return;
	const op = canonicalCapabilityOperation(rows[index].type, operation);
	if (!op) return;
	setCapabilityOperationSelected(index, op, true);
}

function removeCapabilityOperation(index: number, operation: string): void {
	setCapabilityOperationSelected(index, operation, false);
}

	function addCapabilityRequirement(): void {
		const rows = listMcpDefaultCapabilities();
	const fallbackType = capabilityCatalog[0]?.type ?? '';
	if (!fallbackType) return;
	const fallbackScopes = capabilityCatalog[0]?.scopes ?? ['$USER'];
	rows.push({ type: fallbackType, operations: [], scope: fallbackScopes[0] ?? '$USER' });
		updateMcpDefaultCapabilities(rows);
	}

	function removeCapabilityRequirement(index: number): void {
		const rows = listMcpDefaultCapabilities();
		if (index < 0 || index >= rows.length) return;
		rows.splice(index, 1);
		updateMcpDefaultCapabilities(rows);
	}

function scopesForType(type: string): string[] {
	const found = capabilityCatalog.find((item) => item.type === type);
	if (!found || found.scopes.length === 0) return ['$APP', '$USER'];
	return found.scopes;
}

function operationsForType(type: string): string[] {
	const found = capabilityCatalog.find((item) => item.type === type);
	if (!found || found.operations.length === 0) return [];
	return found.operations;
}

function capabilityLabel(type: string): string {
	const found = capabilityCatalog.find((item) => item.type === type);
	if (!found) return type;
	return found.label && found.label.trim().length > 0 ? found.label : found.type;
}

function capabilityDescription(type: string): string {
	const found = capabilityCatalog.find((item) => item.type === type);
	if (!found) return '';
	return found.description?.trim() ?? '';
}

function operationDescription(type: string, operation: string): string {
	const found = capabilityCatalog.find((item) => item.type === type);
	if (!found) return '';
	const map = found.operation_descriptions ?? {};
	if (typeof map[operation] === 'string') return map[operation];
	const lower = operation.toLowerCase();
	for (const [key, value] of Object.entries(map)) {
		if (key.toLowerCase() === lower && typeof value === 'string') {
			return value;
		}
	}
	return '';
}

	async function loadCapabilitiesCatalog(): Promise<void> {
		capabilityCatalogLoading = true;
		capabilityCatalogWarning = '';
		try {
			const data = (await fetchJson('/api/remote/capabilities/catalog')) as {
				catalog?: CapabilityCatalogItem[];
				source?: 'api';
				warning?: string | null;
			};
			capabilityCatalog = Array.isArray(data.catalog) ? data.catalog : [];
			capabilityCatalogSource = data.source ?? null;
			capabilityCatalogWarning = data.warning ?? '';
		} catch (err) {
			capabilityCatalog = [];
			capabilityCatalogSource = null;
			capabilityCatalogWarning =
				err instanceof Error
				? err.message
				: 'Не удалось загрузить справочник разрешений из Ladcraft API';
		} finally {
			capabilityCatalogLoading = false;
		}
	}

	function collectInstallEnvFieldsFromMcp(mcpSpec: Record<string, unknown> | null): InstallEnvField[] {
		const rows: InstallEnvField[] = [];
		if (!mcpSpec) return [];
		const tools = Array.isArray(mcpSpec['tools']) ? mcpSpec['tools'] : [];
		for (const raw of tools) {
			if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue;
			const t = raw as Record<string, unknown>;
			const toolName = typeof t.name === 'string' ? t.name.trim() : '';
			if (!toolName) continue;
			const env = t.environment;
			if (!env || typeof env !== 'object' || Array.isArray(env)) continue;
			const user = (env as Record<string, unknown>).user;
			if (!user || typeof user !== 'object' || Array.isArray(user)) continue;
			for (const [key, meta] of Object.entries(user)) {
				const m = meta as Record<string, unknown>;
				const title =
					typeof m?.title === 'string' && m.title.trim().length > 0 ? m.title.trim() : key;
				const format =
					typeof m?.format === 'string' && m.format.trim().length > 0
						? m.format.trim()
						: 'string';
				rows.push({ toolName, key, title, format });
			}
		}
		return rows;
	}

	function updateMcpSpecObject(next: Record<string, unknown>): void {
		mcpSpecJson = JSON.stringify(next, null, 2);
		if (selectedSkillName.trim()) {
			scheduleMcpSpecDraftPersist(selectedSkillName);
		}
	}

	function removeEnvironmentUserField(toolName: string, key: string): void {
		const mcp = currentMcpSpecObject() ?? {};
		const tools = Array.isArray(mcp.tools) ? [...mcp.tools] : [];
		const idx = tools.findIndex(
			(raw) => typeof (raw as Record<string, unknown>)?.name === 'string' && (raw as Record<string, unknown>).name === toolName
		);
		if (idx < 0) return;
		const tool = { ...(tools[idx] as Record<string, unknown>) };
		const environment = ((tool.environment as Record<string, unknown> | undefined) ?? {}) as Record<
			string,
			unknown
		>;
		const user = ((environment.user as Record<string, unknown> | undefined) ?? {}) as Record<
			string,
			unknown
		>;
		delete user[key];
		environment.user = user;
		tool.environment = environment;
		tools[idx] = tool;
		updateMcpSpecObject({ ...mcp, tools });
	}

	function upsertEnvironmentUserFieldForAllToolsByKey(
		key: string,
		patch: Partial<{ title: string; format: string }>
	): void {
		const mcp = currentMcpSpecObject() ?? {};
		const tools = Array.isArray(mcp.tools) ? [...mcp.tools] : [];
		let changed = false;
		for (let i = 0; i < tools.length; i += 1) {
			const tool = { ...(tools[i] as Record<string, unknown>) };
			const environment = ((tool.environment as Record<string, unknown> | undefined) ?? {}) as Record<
				string,
				unknown
			>;
			const user = ((environment.user as Record<string, unknown> | undefined) ?? {}) as Record<
				string,
				unknown
			>;
			if (!Object.prototype.hasOwnProperty.call(user, key)) continue;
			const current = (user[key] as Record<string, unknown> | undefined) ?? {
				title: key,
				format: 'string'
			};
			const next = {
				title: patch.title ?? String(current.title ?? key),
				format: patch.format ?? String(current.format ?? 'string')
			};
			if (
				String(current.title ?? key) === next.title &&
				String(current.format ?? 'string') === next.format
			) {
				continue;
			}
			user[key] = next;
			environment.user = user;
			tool.environment = environment;
			tools[i] = tool;
			changed = true;
		}
		if (changed) {
			updateMcpSpecObject({ ...mcp, tools });
		}
	}

	function removeEnvironmentAppField(toolName: string, key: string): void {
		const mcp = currentMcpSpecObject() ?? {};
		const tools = Array.isArray(mcp.tools) ? [...mcp.tools] : [];
		const idx = tools.findIndex(
			(raw) =>
				typeof (raw as Record<string, unknown>)?.name === 'string' &&
				(raw as Record<string, unknown>).name === toolName
		);
		if (idx < 0) return;
		const tool = { ...(tools[idx] as Record<string, unknown>) };
		const environment = ((tool.environment as Record<string, unknown> | undefined) ?? {}) as Record<
			string,
			unknown
		>;
		const app = ((environment.app as Record<string, unknown> | undefined) ?? {}) as Record<
			string,
			unknown
		>;
		delete app[key];
		environment.app = app;
		tool.environment = environment;
		tools[idx] = tool;
		updateMcpSpecObject({ ...mcp, tools });
	}

	function upsertEnvironmentAppFieldForAllToolsByKey(key: string, value: string): void {
		const mcp = currentMcpSpecObject() ?? {};
		const tools = Array.isArray(mcp.tools) ? [...mcp.tools] : [];
		let changed = false;
		for (let i = 0; i < tools.length; i += 1) {
			const tool = { ...(tools[i] as Record<string, unknown>) };
			const environment = ((tool.environment as Record<string, unknown> | undefined) ?? {}) as Record<
				string,
				unknown
			>;
			const app = ((environment.app as Record<string, unknown> | undefined) ?? {}) as Record<
				string,
				unknown
			>;
			if (!Object.prototype.hasOwnProperty.call(app, key)) continue;
			if (String(app[key] ?? '') === value) continue;
			app[key] = value;
			environment.app = app;
			tool.environment = environment;
			tools[i] = tool;
			changed = true;
		}
		if (changed) {
			updateMcpSpecObject({ ...mcp, tools });
		}
	}

	function listMcpEnvironmentByTool(): McpEnvironmentByTool[] {
		const mcp = currentMcpSpecObject();
		if (!mcp || !Array.isArray(mcp.tools)) return [];
		const rows: McpEnvironmentByTool[] = [];
		for (const toolRaw of mcp.tools) {
			const tool = toolRaw as Record<string, unknown>;
			const toolName = typeof tool.name === 'string' ? tool.name : '';
			if (!toolName) continue;
			const environment = tool.environment as Record<string, unknown> | undefined;
			const user = (environment?.user as Record<string, unknown> | undefined) ?? {};
			const app = (environment?.app as Record<string, unknown> | undefined) ?? {};
			const userRows: McpUserEnvRow[] = [];
			const appRows: McpAppEnvRow[] = [];
			for (const [key, metaRaw] of Object.entries(user)) {
				const meta = (metaRaw as Record<string, unknown> | undefined) ?? {};
				userRows.push({
					key,
					title: typeof meta.title === 'string' ? meta.title : key,
					format: typeof meta.format === 'string' ? meta.format : 'string'
				});
			}
			for (const [key, value] of Object.entries(app)) {
				appRows.push({
					key,
					value:
						typeof value === 'string'
							? value
							: typeof value === 'number' || typeof value === 'boolean'
								? String(value)
								: ''
				});
			}
			rows.push({ toolName, userRows, appRows });
		}
		return rows;
	}

	function removeEnvironmentUserFieldForAllToolsByKey(key: string): void {
		const envByTool = listMcpEnvironmentByTool();
		for (const tool of envByTool) {
			if (tool.userRows.some((row) => row.key === key)) {
				removeEnvironmentUserField(tool.toolName, key);
			}
		}
	}

	function removeEnvironmentAppFieldForAllToolsByKey(key: string): void {
		const envByTool = listMcpEnvironmentByTool();
		for (const tool of envByTool) {
			if (tool.appRows.some((row) => row.key === key)) {
				removeEnvironmentAppField(tool.toolName, key);
			}
		}
	}

	function listMergedUserEnvRows(): MergedUserEnvRow[] {
		const grouped = new Map<
			string,
			{ title: string; format: string; toolNames: string[]; hasMixedTitle: boolean; hasMixedFormat: boolean }
		>();
		for (const tool of listMcpEnvironmentByTool()) {
			for (const row of tool.userRows) {
				const existing = grouped.get(row.key);
				if (!existing) {
					grouped.set(row.key, {
						title: row.title,
						format: row.format,
						toolNames: [tool.toolName],
						hasMixedTitle: false,
						hasMixedFormat: false
					});
					continue;
				}
				if (!existing.toolNames.includes(tool.toolName)) existing.toolNames.push(tool.toolName);
				if (existing.title !== row.title) existing.hasMixedTitle = true;
				if (existing.format !== row.format) existing.hasMixedFormat = true;
			}
		}
		return Array.from(grouped.entries())
			.map(([key, value]) => ({ key, ...value }))
			.sort((a, b) => a.key.localeCompare(b.key));
	}

	function listMergedAppEnvRows(): MergedAppEnvRow[] {
		const grouped = new Map<
			string,
			{ value: string; toolNames: string[]; hasMixedValues: boolean }
		>();
		for (const tool of listMcpEnvironmentByTool()) {
			for (const row of tool.appRows) {
				const existing = grouped.get(row.key);
				if (!existing) {
					grouped.set(row.key, {
						value: row.value,
						toolNames: [tool.toolName],
						hasMixedValues: false
					});
					continue;
				}
				if (!existing.toolNames.includes(tool.toolName)) existing.toolNames.push(tool.toolName);
				if (existing.value !== row.value) existing.hasMixedValues = true;
			}
		}
		return Array.from(grouped.entries())
			.map(([key, value]) => ({ key, ...value }))
			.sort((a, b) => a.key.localeCompare(b.key));
	}

	function parseInstallationFormFromUi(
		fields: InstallEnvField[],
		values: Record<string, string>
	): string | InstallationFormByTool {
		const mergedByKey = new Map<string, MergedInstallEnvField>();
		for (const field of fields) {
			if (!mergedByKey.has(field.key)) {
				mergedByKey.set(field.key, {
					key: field.key,
					title: field.title,
					format: field.format,
					toolNames: [],
					hasMixedTitle: false,
					hasMixedFormat: false
				});
			}
		}
		const parsedByKey: Record<string, InstallationFormValue> = {};
		for (const merged of mergedByKey.values()) {
			const raw = (values[merged.key] ?? '').trim();
			if (merged.format === 'boolean') {
				const v = values[merged.key] ?? '';
				if (v !== 'true' && v !== 'false') {
					return `Поле «${merged.title}»: выберите значение (true / false)`;
				}
				parsedByKey[merged.key] = v === 'true';
				continue;
			}
			if (!raw) {
				return `Заполните поле «${merged.title}»`;
			}
			if (merged.format === 'number') {
				const n = Number(raw);
				if (!Number.isFinite(n)) {
					return `Поле «${merged.title}»: укажите число`;
				}
				parsedByKey[merged.key] = n;
				continue;
			}
			if (merged.format === 'uri') {
				if (!/^https?:\/\/.+/i.test(raw)) {
					return `Поле «${merged.title}»: укажите URL (http или https)`;
				}
				parsedByKey[merged.key] = raw;
				continue;
			}
			if (merged.format === 'email') {
				if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(raw)) {
					return `Поле «${merged.title}»: укажите корректный email`;
				}
				parsedByKey[merged.key] = raw;
				continue;
			}
			parsedByKey[merged.key] = raw;
		}

		const out: InstallationFormByTool = {};
		for (const f of fields) {
			if (!out[f.toolName]) out[f.toolName] = {};
			out[f.toolName][f.key] = parsedByKey[f.key];
		}
		return out;
	}

	function buildInstallationFormDraftFromUiValues(
		fields: InstallEnvField[],
		values: Record<string, string>
	): InstallationFormByTool {
		const out: InstallationFormByTool = {};
		for (const f of fields) {
			if (!out[f.toolName]) out[f.toolName] = {};
			out[f.toolName][f.key] = values[f.key] ?? '';
		}
		return out;
	}

	function openInstallEnvModal(
		fields: InstallEnvField[],
		onDone: (form: InstallationFormByTool) => void,
		initialValues?: InstallationFormByTool
	): void {
		installEnvFields = fields;
		const valuesByKey: Record<string, string> = {};
		for (const f of fields) {
			if (valuesByKey[f.key] !== undefined && valuesByKey[f.key] !== '') continue;
			const raw = initialValues?.[f.toolName]?.[f.key];
			if (raw === undefined || raw === null) {
				continue;
			}
			if (f.format === 'boolean') {
				if (raw === true || raw === 'true') valuesByKey[f.key] = 'true';
				else if (raw === false || raw === 'false') valuesByKey[f.key] = 'false';
				else if (valuesByKey[f.key] === undefined) valuesByKey[f.key] = '';
				continue;
			}
			valuesByKey[f.key] = String(raw);
		}
		for (const f of fields) {
			if (valuesByKey[f.key] === undefined) valuesByKey[f.key] = '';
		}
		installEnvValues = valuesByKey;
		installEnvError = '';
		installEnvModalOpen = true;
		installEnvCallback = onDone;
	}

	async function persistInstallFormDraft(skillName: string, form: InstallationFormByTool): Promise<void> {
		if (!skillName.trim()) return;
		try {
			await fetchJson(
				`/api/local/skills/${encodeURIComponent(skillName)}/installation-form-draft`,
				{
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ installationForm: form })
				}
			);
		} catch {
			// Нефатально: не блокируем deploy из-за ошибки сохранения черновика.
		}
	}

	function scheduleInstallFormDraftPersist(): void {
		if (!installEnvModalOpen || !selectedSkillName.trim()) return;
		if (installEnvDraftSaveTimerId) {
			clearTimeout(installEnvDraftSaveTimerId);
		}
		installEnvDraftSaveTimerId = window.setTimeout(() => {
			installEnvDraftSaveTimerId = null;
			const draft = buildInstallationFormDraftFromUiValues(installEnvFields, installEnvValues);
			void persistInstallFormDraft(selectedSkillName, draft);
		}, 300);
	}

	async function confirmInstallEnvModal(): Promise<void> {
		if (installEnvDraftSaveTimerId) {
			clearTimeout(installEnvDraftSaveTimerId);
			installEnvDraftSaveTimerId = null;
		}
		const parsed = parseInstallationFormFromUi(installEnvFields, installEnvValues);
		if (typeof parsed === 'string') {
			installEnvError = parsed;
			return;
		}
		if (selectedSkillName) {
			await persistInstallFormDraft(selectedSkillName, parsed);
		}
		installEnvModalOpen = false;
		const cb = installEnvCallback;
		installEnvCallback = null;
		cb?.(parsed);
	}

	function cancelInstallEnvModal(): void {
		if (selectedSkillName) {
			const draft = buildInstallationFormDraftFromUiValues(installEnvFields, installEnvValues);
			void persistInstallFormDraft(selectedSkillName, draft);
		}
		if (installEnvDraftSaveTimerId) {
			clearTimeout(installEnvDraftSaveTimerId);
			installEnvDraftSaveTimerId = null;
		}
		installEnvModalOpen = false;
		installEnvCallback = null;
		installEnvError = '';
	}

	function setEditorFromPayload(payload: SkillPayload, oldName: string | null = null): void {
		formName = payload.name;
		formDescription = payload.description;
		formBody = payload.body;
		scriptsJson = JSON.stringify(payload.scripts || [], null, 2);
		widgetsJson = JSON.stringify(payload.widgets || [], null, 2);
		mcpSpecJson = JSON.stringify(payload.mcp_spec || {}, null, 2);
		applyPersistedMcpSpecDraft(payload.name);
		previousSkillName = oldName ?? payload.name;
		// Очищаем результаты предыдущего навыка
		widgetHtml = '';
		widgetName = '';
		output = '';
		logs = [];
		outputDetailsOpen = false;
		deployError = '';
		deployResult = null;
		scriptInputData = {};
		scriptInputJson = '{}';
		ensureScriptSelected();
	}

	function isSkillListBusy(): boolean {
		return (
			localListLoading ||
			localSkillLoading ||
			prototypeListLoading ||
			prototypeSkillLoading ||
			deleteSkillLoading ||
			downloadFromServerLoading ||
			syncPrototypeLoading ||
			copyPrototypeLoading
		);
	}

	function buildPayloadFromForm(): SkillPayload {
		if (!formName.trim() || !formDescription.trim() || !formBody.trim()) {
			throw new Error('Поля "Название", "Описание" и "Body" обязательны');
		}

		const scripts = parseJson<SkillScript[]>(scriptsJson, 'Скрипты');
		const widgets = parseJson<Array<Record<string, unknown>>>(widgetsJson, 'Виджеты');
		const mcpSpecObj = parseJson<Record<string, unknown>>(mcpSpecJson, 'MCP Spec');

		return {
			name: formName.trim(),
			description: formDescription.trim(),
			body: formBody,
			scripts,
			widgets,
			mcp_spec: Object.keys(mcpSpecObj).length ? mcpSpecObj : null
		};
	}

	function scriptNames(): string[] {
		try {
			const scripts = parseJson<SkillScript[]>(scriptsJson, 'Скрипты');
			return scripts
				.map((s) => s.name)
				.filter((name) => typeof name === 'string' && name.length > 0);
		} catch {
			return [];
		}
	}

	/** Выбранный скрипт по текущим scriptsJson и selectedScriptName */
	function selectedScript(): SkillScript | null {
		try {
			const scripts = parseJson<SkillScript[]>(scriptsJson, 'Скрипты');
			const name = selectedScriptName;
			return name ? (scripts.find((s) => s.name === name) ?? null) : null;
		} catch {
			return null;
		}
	}

	/** Сводка input_schema выбранного скрипта: обязательные поля и все свойства (для подсказки «Параметры (JSON)») */
	function scriptInputSchemaSummary(script: SkillScript | null): {
		required: string[];
		properties: Array<{ name: string; type: string; description?: string }>;
	} {
		const required: string[] = [];
		const properties: Array<{ name: string; type: string; description?: string }> = [];
		if (!script?.input_schema) return { required, properties };
		const schema = script.input_schema as {
			required?: string[];
			properties?: Record<string, { type?: string; description?: string }>;
		};
		if (Array.isArray(schema.required)) required.push(...schema.required);
		const props = schema.properties;
		if (props && typeof props === 'object') {
			for (const [name, def] of Object.entries(props)) {
				if (typeof def !== 'object' || !def) continue;
				const type = typeof def.type === 'string' ? def.type : 'unknown';
				const description = typeof def.description === 'string' ? def.description : undefined;
				properties.push({ name, type, description });
			}
		}
		return { required, properties };
	}

	/** Поля input_schema, связанные с возвратом в виджет — подставляются при запуске для превью */
	function widgetParamsFromScript(script: SkillScript | null): {
		keys: string[];
		example: Record<string, unknown>;
	} {
		const example: Record<string, unknown> = {};
		const keys: string[] = [];
		if (!script?.input_schema) return { keys, example };
		const props = script.input_schema.properties as
			| Record<string, { type?: string; default?: unknown; description?: string }>
			| undefined;
		if (!props || typeof props !== 'object') return { keys, example };
		for (const [key, def] of Object.entries(props)) {
			if (typeof def !== 'object' || !def) continue;
			const desc = typeof def.description === 'string' ? def.description.toLowerCase() : '';
			const keyLower = key.toLowerCase();
			const isWidget =
				keyLower.includes('widget') || desc.includes('виджет') || desc.includes('widget');
			if (!isWidget) continue;
			keys.push(key);
			if (def.type === 'boolean') example[key] = true;
			else if (def.default !== undefined) example[key] = def.default;
			else example[key] = true;
		}
		return { keys, example };
	}

	function ensureScriptSelected(): void {
		const names = scriptNames();
		if (names.length === 0) {
			selectedScriptName = '';
			return;
		}
		if (!names.includes(selectedScriptName)) {
			selectedScriptName = names[0];
		}
	}

	function setResult(data: unknown): void {
		output = JSON.stringify(data, null, 2);
		const resultObj = data && typeof data === 'object' ? (data as Record<string, unknown>) : {};

		// Правильно обрабатываем виджет из ответа API
		// API возвращает { ok: true, result: ..., logs: ..., widget: { name, html } }
		const widget =
			resultObj.widget && typeof resultObj.widget === 'object'
				? (resultObj.widget as Record<string, unknown>)
				: null;
		if (widget) {
			widgetHtml = typeof widget.html === 'string' ? widget.html : '';
			widgetName = typeof widget.name === 'string' ? widget.name : '';
		} else {
			// Если виджет не передан напрямую, проверяем структуру __widget__ в result
			const result = resultObj.result;
			if (result && typeof result === 'object') {
				const resultRecord = result as Record<string, unknown>;
				if (resultRecord.__widget__ && typeof resultRecord.__widget__ === 'object') {
					const widgetSpec = resultRecord.__widget__ as Record<string, unknown>;
					// Виджет будет обработан на сервере, но на всякий случай сохраняем информацию
					widgetName = typeof widgetSpec.widget === 'string' ? widgetSpec.widget : '';
				}
			}
			if (!widgetHtml) {
				widgetHtml = '';
				if (!widgetName) widgetName = '';
			}
		}

		logs = Array.isArray(resultObj.logs) ? resultObj.logs.map((item) => String(item)) : [];
	}

	async function fetchJson(path: string, init?: RequestInit): Promise<unknown> {
		const controller = new AbortController();
		const timeoutId = window.setTimeout(() => controller.abort(), requestTimeoutMs);
		try {
			const response = await fetch(`${apiBase}${path}`, { ...init, signal: controller.signal });
			const text = await response.text();
			let data: unknown = null;
			if (text.trim()) {
				try {
					data = JSON.parse(text);
				} catch {
					data = { raw: text };
				}
			}
			if (!response.ok) {
				const message =
					typeof (data as { error?: unknown })?.error === 'string'
						? (data as { error: string }).error
						: `Ошибка запроса: ${response.status}`;
				if (
					(response.status === 401 || response.status === 403) &&
					path.startsWith('/api/remote/')
				) {
					throw new Error(`LADCRAFT_AUTH_EXPIRED: ${message}`);
				}
				throw new Error(message);
			}
			return data;
		} catch (err) {
			if (err instanceof DOMException && err.name === 'AbortError') {
				throw new Error(`Таймаут API через ${requestTimeoutMs} мс (${apiBase}${path})`);
			}
			if (err instanceof TypeError) {
				throw new Error(`Нет соединения с API ${apiBase}. Проверь, что dev-server запущен.`);
			}
			throw err;
		} finally {
			window.clearTimeout(timeoutId);
		}
	}

	async function refreshHealthInfo(): Promise<HealthInfo | null> {
		const data = await fetchJson('/api/health');
		healthInfo = data && typeof data === 'object' ? (data as HealthInfo) : null;
		if (healthInfo?.bundleUpdateStatus) {
			bundleUpdateStatus = healthInfo.bundleUpdateStatus;
			if (healthInfo.bundleUpdateStatus.state === 'running') {
				ensureBundleUpdatePolling();
			} else {
				clearBundleUpdatePolling();
			}
		}
		return healthInfo;
	}

	function isBundleUpdateRunning(status = bundleUpdateStatus): boolean {
		return status?.state === 'running';
	}

	function shouldShowBundleUpdateBanner(): boolean {
		if (healthInfo?.cursorLadcraftBundleOutdated) return true;
		if (!bundleUpdateStatus) return false;
		return bundleUpdateStatus.state === 'running' || bundleUpdateStatus.state === 'failed';
	}

	function clearBundleUpdatePolling(): void {
		if (!bundleUpdatePollTimer) return;
		window.clearInterval(bundleUpdatePollTimer);
		bundleUpdatePollTimer = null;
	}

	function ensureBundleUpdatePolling(): void {
		if (bundleUpdatePollTimer) return;
		bundleUpdatePollTimer = window.setInterval(() => {
			void loadBundleUpdateStatus();
		}, 1500);
	}

	async function loadBundleUpdateStatus(): Promise<BundleUpdateStatus | null> {
		try {
			const data = (await fetchJson('/api/system/update/status')) as { status?: BundleUpdateStatus };
			bundleUpdateStatus = data?.status ?? null;
			if (isBundleUpdateRunning()) {
				ensureBundleUpdatePolling();
			} else {
				clearBundleUpdatePolling();
			}
			return bundleUpdateStatus;
		} catch (err) {
			bundleUpdateError =
				err instanceof Error ? err.message : 'Не удалось получить статус автообновления';
			return null;
		}
	}

	async function startBundleUpdate(): Promise<void> {
		if (bundleUpdateStarting || isBundleUpdateRunning()) return;
		bundleUpdateStarting = true;
		bundleUpdateError = '';
		try {
			const data = (await fetchJson('/api/system/update/start', {
				method: 'POST'
			})) as { status?: BundleUpdateStatus };
			bundleUpdateStatus = data?.status ?? null;
			ensureBundleUpdatePolling();
		} catch (err) {
			bundleUpdateError =
				err instanceof Error ? err.message : 'Не удалось запустить автообновление';
		} finally {
			bundleUpdateStarting = false;
		}
	}

	function authStatusForEnv(env: LadcraftEnvironment): boolean {
		return Boolean(healthInfo?.authStatuses?.[env]);
	}

	function authStatusLabel(env: LadcraftEnvironment): string {
		return authStatusForEnv(env) ? 'вход выполнен ✅' : 'нужно войти ❌';
	}

	function closeAuthFailureModal(): void {
		authFailureModalMessage = null;
	}

	function openAuthFailureModal(title: string, detail: string): void {
		authFailureModalTitle = title;
		authFailureModalMessage = detail;
		authPanelOpen = true;
	}

	function isLadcraftAuthExpiredErrorMessage(message: string): boolean {
		return message.includes('LADCRAFT_AUTH_EXPIRED:');
	}

	function markAuthExpiredFromError(err: unknown): string {
		const message = err instanceof Error ? err.message : String(err);
		if (isLadcraftAuthExpiredErrorMessage(message)) {
			remoteAuthExpired = true;
			authPanelOpen = true;
			const activeEnv = (healthInfo?.ladcraftEnv ?? 'dev') as LadcraftEnvironment;
			const nextStatuses = {
				...(healthInfo?.authStatuses ?? {}),
				[activeEnv]: false
			};
			healthInfo = healthInfo
				? { ...healthInfo, hasSkilledAgentToken: false, authStatuses: nextStatuses }
				: { hasSkilledAgentToken: false, authStatuses: nextStatuses };
			const cleaned = message.replace('LADCRAFT_AUTH_EXPIRED:', '').trim();
			openAuthFailureModal('Сессия Ladcraft недействительна', cleaned);
			return cleaned;
		}
		return message;
	}

	function clearManualTokenState(): void {
		manualTokenError = '';
		authLoginError = '';
		authLogoutError = '';
	}

	function openFaqModal(): void {
		faqModalOpen = true;
	}

	function closeFaqModal(): void {
		faqModalOpen = false;
	}

	async function loginByCredentials(): Promise<void> {
		clearManualTokenState();
		if (!authEmail.trim()) {
			authLoginError = 'Введите email';
			return;
		}
		if (!authPassword.trim()) {
			authLoginError = 'Введите пароль';
			return;
		}
		authLoginLoading = true;
		try {
			await fetchJson('/api/auth/login', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ email: authEmail.trim(), password: authPassword })
			});
			authPassword = '';
			remoteAuthExpired = false;
			healthInfo = healthInfo
				? { ...healthInfo, hasSkilledAgentToken: true }
				: { hasSkilledAgentToken: true };
			await refreshHealthInfo().catch(() => {});
			await loadCapabilitiesCatalog().catch(() => {});
			setResult({ ok: true, message: 'Авторизация успешна. Ladcraft-сессия активна.' });
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			authLoginError = msg;
			openAuthFailureModal('Не удалось войти в Ladcraft', msg);
		} finally {
			authLoginLoading = false;
		}
	}

	async function switchLadcraftEnvironment(environment: LadcraftEnvironment): Promise<void> {
		if (envSwitching) return;
		if (healthInfo?.ladcraftEnv === environment) return;
		envSwitching = true;
		clearManualTokenState();
		try {
			const data = (await fetchJson('/api/auth/environment', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ environment })
			})) as {
				ladcraftEnv?: LadcraftEnvironment;
				hasSkilledAgentToken?: boolean;
				authStatuses?: Partial<Record<LadcraftEnvironment, boolean>>;
			};
			remoteAuthExpired = false;
			runtimeResetAfterEnvSwitch();
			healthInfo = healthInfo
				? {
					...healthInfo,
					ladcraftEnv: data.ladcraftEnv ?? environment,
					hasSkilledAgentToken: Boolean(data.hasSkilledAgentToken),
					authStatuses: data.authStatuses ?? healthInfo.authStatuses
				  }
				: {
					ladcraftEnv: data.ladcraftEnv ?? environment,
					hasSkilledAgentToken: Boolean(data.hasSkilledAgentToken),
					authStatuses: data.authStatuses
				  };
			await refreshHealthInfo();
			await loadCapabilitiesCatalog().catch(() => {});
			setResult({
				ok: true,
				message: Boolean(data.hasSkilledAgentToken)
					? `Окружение переключено на ${environment.toUpperCase()}. Токен найден ✅, можно отправлять.`
					: `Окружение переключено на ${environment.toUpperCase()}. Для этой среды нужна авторизация ❌.`
			});
		} catch (err) {
			manualTokenError = err instanceof Error ? err.message : String(err);
		} finally {
			envSwitching = false;
		}
	}

	function runtimeResetAfterEnvSwitch(): void {
		remoteSkills = [];
		remoteSkillsMeta = {};
		conflictDismissed = new Set();
	}

	async function saveManualToken(): Promise<void> {
		clearManualTokenState();
		if (!manualToken.trim()) {
			manualTokenError = 'Введите access token Ladcraft';
			return;
		}
		manualTokenUpdating = true;
		try {
			await fetchJson('/api/auth/token', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ token: manualToken.trim() })
			});
			manualToken = '';
			remoteAuthExpired = false;
			healthInfo = healthInfo
				? { ...healthInfo, hasSkilledAgentToken: true }
				: { hasSkilledAgentToken: true };
			await refreshHealthInfo().catch(() => {});
			await loadCapabilitiesCatalog().catch(() => {});
			setResult({ ok: true, message: 'Токен обновлен. Ladcraft-сессия активна.' });
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			manualTokenError = msg;
			openAuthFailureModal('Не удалось сохранить токен', msg);
		} finally {
			manualTokenUpdating = false;
		}
	}

	async function logoutFromLadcraftEnvironment(environment: LadcraftEnvironment): Promise<void> {
		if (authLogoutLoadingEnv) return;
		authLogoutLoadingEnv = environment;
		authLogoutError = '';
		try {
			const data = (await fetchJson('/api/auth/logout', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ environment })
			})) as {
				ladcraftEnv?: LadcraftEnvironment;
				hasSkilledAgentToken?: boolean;
				authStatuses?: Partial<Record<LadcraftEnvironment, boolean>>;
			};
			remoteAuthExpired = false;
			healthInfo = healthInfo
				? {
					...healthInfo,
					ladcraftEnv: data.ladcraftEnv ?? healthInfo.ladcraftEnv,
					hasSkilledAgentToken: Boolean(data.hasSkilledAgentToken),
					authStatuses: data.authStatuses ?? healthInfo.authStatuses
				  }
				: {
					ladcraftEnv: data.ladcraftEnv,
					hasSkilledAgentToken: Boolean(data.hasSkilledAgentToken),
					authStatuses: data.authStatuses
				  };
			await refreshHealthInfo().catch(() => {});
			setResult({
				ok: true,
				message: `Сессия ${environment.toUpperCase()} очищена.`
			});
		} catch (err) {
			authLogoutError = err instanceof Error ? err.message : String(err);
		} finally {
			authLogoutLoadingEnv = null;
		}
	}

	function saveCurrentSkillToStore(name: string): void {
		if (!name.trim()) return;
		const existing = skillStateStore[name];
		const scriptInputByScript = { ...(existing?.scriptInputByScript ?? {}) };
		scriptInputByScript[selectedScriptName] = {
			scriptInputData: { ...scriptInputData },
			scriptInputJson
		};
		skillStateStore[name] = {
			formName,
			formDescription,
			formBody,
			scriptsJson,
			widgetsJson,
			mcpSpecJson,
			selectedScriptName,
			scriptInputData: { ...scriptInputData },
			scriptInputJson,
			scriptInputByScript
		};
	}

	function restoreFromStore(name: string): void {
		const saved = skillStateStore[name];
		if (!saved) return;
		formName = saved.formName;
		formDescription = saved.formDescription;
		formBody = saved.formBody;
		scriptsJson = saved.scriptsJson;
		widgetsJson = saved.widgetsJson;
		mcpSpecJson = saved.mcpSpecJson;
		selectedScriptName = saved.selectedScriptName;
		const scriptSaved = saved.scriptInputByScript?.[saved.selectedScriptName];
		if (scriptSaved) {
			scriptInputData = { ...scriptSaved.scriptInputData };
			scriptInputJson = scriptSaved.scriptInputJson;
		} else {
			scriptInputData = { ...saved.scriptInputData };
			scriptInputJson = saved.scriptInputJson;
		}
	}

	/** Сохраняет текущий ввод параметров выбранного скрипта в стор (при переключении скрипта в списке). */
	function saveScriptInputForScript(scriptName: string): void {
		if (!formName.trim() || !scriptName) return;
		const existing = skillStateStore[formName];
		const scriptInputByScript = { ...(existing?.scriptInputByScript ?? {}) };
		scriptInputByScript[scriptName] = { scriptInputData: { ...scriptInputData }, scriptInputJson };
		skillStateStore[formName] = existing
			? { ...existing, scriptInputByScript }
			: {
					formName,
					formDescription,
					formBody,
					scriptsJson,
					widgetsJson,
					mcpSpecJson,
					selectedScriptName,
					scriptInputData: {},
					scriptInputJson: '{}',
					scriptInputByScript
				};
	}
	/** Восстанавливает ввод параметров для скрипта из стора. */
	function restoreScriptInputForScript(scriptName: string): void {
		if (!formName.trim()) return;
		const saved = skillStateStore[formName]?.scriptInputByScript?.[scriptName];
		if (saved) {
			scriptInputData = { ...saved.scriptInputData };
			scriptInputJson = saved.scriptInputJson;
		} else {
			scriptInputData = {};
			scriptInputJson = '{}';
		}
	}
	function onScriptChange(newScriptName: string): void {
		const prevName = selectedScriptName;
		saveScriptInputForScript(prevName);
		selectedScriptName = newScriptName;
		restoreScriptInputForScript(newScriptName);
	}

	async function loadLocalSkills(
		preferSelected = true,
		options?: { quiet?: boolean }
	): Promise<void> {
		const quiet = options?.quiet === true;
		if (!quiet) {
			localListLoading = true;
			listLoadError = '';
		}
		try {
			const data = (await fetchJson('/api/local/skills')) as {
				skills?: LocalSkillMeta[];
				compatibilityAudit?: SkillCompatibilityAuditMeta;
			};
			localSkills = Array.isArray(data.skills) ? [...data.skills] : [];
			compatibilityAuditMeta = data.compatibilityAudit ?? null;
			if (localSkills.length === 0) {
				compatibilityReport = null;
				return;
			}

			if (
				preferSelected &&
				selectedSkillName &&
				localSkills.some((s) => s.name === selectedSkillName)
			) {
				await loadLocalSkill(selectedSkillName, { restoreDraftFromStore: false });
				return;
			}

			await loadLocalSkill(localSkills[0].name, { restoreDraftFromStore: false });
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			if (!quiet) {
				listLoadError = msg;
				setResult({ ok: false, error: msg });
			}
		} finally {
			if (!quiet) {
				localListLoading = false;
			}
		}
	}

	async function loadPrototypeSkills(
		preferSelected = true,
		options?: { quiet?: boolean }
	): Promise<void> {
		const quiet = options?.quiet === true;
		if (!quiet) {
			prototypeListLoading = true;
			prototypeListLoadError = '';
		}
		try {
			const data = (await fetchJson('/api/prototype/skills')) as { skills?: LocalSkillMeta[] };
			prototypeSkills = Array.isArray(data.skills) ? [...data.skills] : [];
			if (prototypeSkills.length === 0) {
				return;
			}
			if (
				preferSelected &&
				selectedSkillSource === 'prototype' &&
				selectedSkillName &&
				prototypeSkills.some((skill) => skill.name === selectedSkillName)
			) {
				await loadPrototypeSkill(selectedSkillName);
				return;
			}
			if (activeSkillListTab === 'prototype') {
				await loadPrototypeSkill(prototypeSkills[0].name);
			}
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			if (!quiet) {
				prototypeListLoadError = msg;
				setResult({ ok: false, error: msg });
			}
		} finally {
			if (!quiet) {
				prototypeListLoading = false;
			}
		}
	}

	function clearLocalSkillsPolling(): void {
		if (localSkillsPollTimer != null) {
			clearInterval(localSkillsPollTimer);
			localSkillsPollTimer = null;
		}
	}

	function startLocalSkillsPollingFallback(): void {
		if (localSkillsPollTimer != null) return;
		localSkillsPollTimer = window.setInterval(() => {
			if (document.visibilityState === 'hidden') return;
			if (sseConnected) return;
			runQuietLocalListRefresh();
			runQuietPrototypeListRefresh();
		}, 12_000);
	}

	function runQuietLocalListRefresh(): void {
		if (quietLocalListInFlight) {
			pendingQuietLocalList = true;
			return;
		}
		quietLocalListInFlight = true;
		void loadLocalSkills(true, { quiet: true })
			.catch(() => {})
			.finally(() => {
				quietLocalListInFlight = false;
				if (pendingQuietLocalList) {
					pendingQuietLocalList = false;
					runQuietLocalListRefresh();
				}
			});
	}

	function runQuietPrototypeListRefresh(): void {
		if (quietPrototypeListInFlight) {
			pendingQuietPrototypeList = true;
			return;
		}
		quietPrototypeListInFlight = true;
		void loadPrototypeSkills(true, { quiet: true })
			.catch(() => {})
			.finally(() => {
				quietPrototypeListInFlight = false;
				if (pendingQuietPrototypeList) {
					pendingQuietPrototypeList = false;
					runQuietPrototypeListRefresh();
				}
			});
	}

	function connectSkillsEventSource(): void {
		skillsEventSource?.close();
		const base = apiBase.replace(/\/+$/, '');
		const url = base ? `${base}/api/events` : '/api/events';
		const es = new EventSource(url);
		skillsEventSource = es;
		es.addEventListener('connected', () => {
			sseConnected = true;
			clearLocalSkillsPolling();
		});
		es.addEventListener('local-skills-changed', () => {
			sseConnected = true;
			clearLocalSkillsPolling();
			runQuietLocalListRefresh();
		});
		es.addEventListener('prototype-skills-changed', () => {
			sseConnected = true;
			clearLocalSkillsPolling();
			runQuietPrototypeListRefresh();
		});
		es.onerror = () => {
			sseConnected = false;
			es.close();
			if (skillsEventSource === es) {
				skillsEventSource = null;
			}
			startLocalSkillsPollingFallback();
		};
	}

	async function loadLocalSkill(
		skillName: string,
		options?: { restoreDraftFromStore?: boolean }
	): Promise<void> {
		// Сохраняем состояние текущего навыка в стор перед переключением
		if (selectedSkillName && selectedSkillName !== skillName) {
			saveCurrentSkillToStore(selectedSkillName);
		}
		localSkillLoading = true;
		const timeoutMs = 15000;
		const timeoutId = window.setTimeout(() => {
			if (localSkillLoading) {
				localSkillLoading = false;
				setResult({ ok: false, error: `Загрузка навыка прервана по таймауту (${timeoutMs} мс)` });
			}
		}, timeoutMs);
		try {
			const data = (await fetchJson(`/api/local/skills/${encodeURIComponent(skillName)}`)) as {
				skill?: SkillPayload;
				compatibilityReport?: SkillCompatibilityReport | null;
				compatibilityAudit?: SkillCompatibilityAuditMeta;
			};
			if (!data.skill) throw new Error('В ответе отсутствует payload навыка');
			selectedSkillName = data.skill.name;
			selectedSkillSource = 'ladcraft';
			activeSkillListTab = 'ladcraft';
			compatibilityReport = data.compatibilityReport ?? null;
			compatibilityAuditMeta = data.compatibilityAudit ?? compatibilityAuditMeta;
			setEditorFromPayload(data.skill, data.skill.name);
			if (options?.restoreDraftFromStore !== false) {
				restoreFromStore(data.skill.name);
			}
			ensureScriptSelected();
			await loadDeployHistory();
			await loadRemotePublishedVersion(data.skill.name);
			setResult({ ok: true, loaded: data.skill.name });
		} catch (err) {
			setResult({ ok: false, error: err instanceof Error ? err.message : String(err) });
		} finally {
			window.clearTimeout(timeoutId);
			localSkillLoading = false;
		}
	}

	async function loadPrototypeSkill(skillName: string): Promise<void> {
		if (selectedSkillName && selectedSkillName !== skillName) {
			saveCurrentSkillToStore(selectedSkillName);
		}
		prototypeSkillLoading = true;
		try {
			const data = (await fetchJson(`/api/prototype/skills/${encodeURIComponent(skillName)}`)) as {
				skill?: SkillPayload;
			};
			if (!data.skill) throw new Error('В ответе отсутствует payload навыка');
			selectedSkillName = data.skill.name;
			selectedSkillSource = 'prototype';
			activeSkillListTab = 'prototype';
			compatibilityReport = null;
			setEditorFromPayload(data.skill, data.skill.name);
			deployHistory = [];
			deployPreflight = null;
			postDeployCheck = null;
			remotePublishedVersion = null;
			restoreFromStore(data.skill.name);
			ensureScriptSelected();
			setResult({ ok: true, loadedPrototype: data.skill.name });
		} catch (err) {
			setResult({ ok: false, error: err instanceof Error ? err.message : String(err) });
		} finally {
			prototypeSkillLoading = false;
		}
	}

	async function saveLocalSkill(): Promise<void> {
		if (selectedSkillSource === 'prototype') {
			setResult({
				ok: false,
				error:
					'Сейчас выбран навык прототипа. Сначала нажмите «Подготовить к конвертации», затем редактируйте копию в списке Ladcraft.'
			});
			return;
		}
		saveSkillLoading = true;
		try {
			const payload = buildPayloadFromForm();
			const data = await fetchJson('/api/local/skills/upsert', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					skillPayload: payload,
					previousName: previousSkillName || undefined
				})
			});
			selectedSkillName = payload.name;
			saveCurrentSkillToStore(payload.name);
			const _prevName = previousSkillName;
			previousSkillName = payload.name;
			if (_prevName && _prevName !== payload.name) delete skillStateStore[_prevName];
			await loadLocalSkills(true);
			setResult(data);
		} catch (err) {
			setResult({ ok: false, error: err instanceof Error ? err.message : String(err) });
		} finally {
			saveSkillLoading = false;
		}
	}

	async function runLocalScript(inputOverride?: Record<string, unknown>): Promise<void> {
		runScriptLoading = true;
		try {
			if (!selectedScriptName) throw new Error('Сначала выберите скрипт');
			// Единый источник: при запуске подтягиваем JSON в scriptInputData если форма пуста
			const input: Record<string, unknown> =
				inputOverride ??
				(Object.keys(scriptInputData).length > 0
					? { ...scriptInputData }
					: getScriptInputFromJson());
			// Подставляем параметры для превью виджета только если пользователь их не указал явно
			// НЕ подставляем автоматически - пользователь должен явно указать, хочет ли он виджет
			// const { keys, example } = widgetParamsFromScript(selectedScript());
			// if (keys.length > 0) {
			// 	// Подставляем только те параметры виджета, которые пользователь не указал явно
			// 	for (const key of keys) {
			// 		if (!(key in input) || input[key] === undefined) {
			// 			input[key] = example[key];
			// 		}
			// 	}
			// } else {
			// 	// Если нет специальных полей виджета, подставляем returnAsWidget только если его нет
			// 	if (!('returnAsWidget' in input)) {
			// 		input.returnAsWidget = true;
			// 	}
			// }
			const selected = selectedScript();
			const executeBody: Record<string, unknown> = {
				skillName: formName,
				scriptName: selectedScriptName,
				input: { ...input }
			};
			if (selectedSkillSource === 'prototype' && selected?.code) {
				executeBody.code = selected.code;
			}
			const data = await fetchJson('/api/local/execute', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(executeBody)
			});
			setResult(data);
			outputDetailsOpen = true;
		} catch (err) {
			setResult({ ok: false, error: err instanceof Error ? err.message : String(err) });
			outputDetailsOpen = true;
		} finally {
			runScriptLoading = false;
		}
	}

	/** Парсит scriptInputJson и возвращает объект для input; при валидном JSON обновляет scriptInputData. */
	function getScriptInputFromJson(): Record<string, unknown> {
		try {
			const parsed = scriptInputJson.trim()
				? parseJson<Record<string, unknown>>(scriptInputJson, 'Параметры')
				: {};
			if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
				scriptInputData = parsed;
				return parsed;
			}
		} catch {
			// ignore
		}
		return {};
	}

	/** Обновляет значение в scriptInputData по пути (иммутабельно) и синхронизирует scriptInputJson. */
	function setFormDataAtPath(path: (string | number)[], value: unknown): void {
		if (path.length === 0) return;
		scriptInputData = setInObject(scriptInputData, path, value) as Record<string, unknown>;
		scriptInputJson = JSON.stringify(scriptInputData, null, 2);
	}

	function setInObject(obj: unknown, path: (string | number)[], value: unknown): unknown {
		if (path.length === 0) return value;
		const [first, ...rest] = path;
		if (typeof first === 'number') {
			const arr = Array.isArray(obj) ? [...obj] : [];
			const existing = arr[first];
			arr[first] = rest.length === 0 ? value : setInObject(existing, rest, value);
			return arr;
		} else {
			const record =
				obj && typeof obj === 'object' && !Array.isArray(obj)
					? { ...(obj as Record<string, unknown>) }
					: {};
			const existing = (record as Record<string, unknown>)[first];
			(record as Record<string, unknown>)[first] =
				rest.length === 0 ? value : setInObject(existing, rest, value);
			return record;
		}
	}

	async function loadRemoteSkills(silent = false): Promise<void> {
		remoteSkillsLoadError = '';
		remoteListLoading = true;
		try {
			const data = (await fetchJson('/api/remote/skills')) as {
				skills?: Array<{
					id: string;
					name: string;
					isNew?: boolean;
					hasConflict?: boolean;
					identityKey?: string;
				}>;
			};
			const list = Array.isArray(data.skills) ? data.skills : [];
			remoteSkills = list.map((s) => ({ id: s.id, name: s.name, identityKey: s.identityKey }));
			const meta: Record<string, { id: string; hasConflict: boolean }> = {};
			for (const s of list) {
				const key = s.identityKey || `server:${s.id}`;
				meta[key] = { id: s.id, hasConflict: s.hasConflict === true };
			}
			remoteSkillsMeta = meta;
			remoteAuthExpired = false;
			if (!silent) setResult(data);
		} catch (err) {
			remoteSkillsLoadError = markAuthExpiredFromError(err);
			remoteSkills = [];
			remoteSkillsMeta = {};
			if (!silent) setResult({ ok: false, error: remoteSkillsLoadError });
		} finally {
			remoteListLoading = false;
		}
	}

	async function downloadFromServerAndRefreshLocal(): Promise<void> {
		if (downloadFromServerLoading) return;
		downloadFromServerLoading = true;
		try {
			// Сначала загружаем с сервера — получаем meta с hasConflict по каждому навыку
			await loadRemoteSkills(false);
			// Затем обновляем локальный список (remoteSkillsMeta не трогаем)
			await loadLocalSkills(false);
		} finally {
			downloadFromServerLoading = false;
		}
	}

	async function syncPrototypeSkills(): Promise<void> {
		if (syncPrototypeLoading) return;
		syncPrototypeLoading = true;
		try {
			prototypeListLoadError = '';
			await fetchJson('/api/prototype/skills/sync', { method: 'POST' });
			await loadPrototypeSkills(false);
			setResult({ ok: true, message: 'Навыки прототипа загружены' });
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			prototypeListLoadError = msg;
			setResult({ ok: false, error: msg });
		} finally {
			syncPrototypeLoading = false;
		}
	}

	async function copyPrototypeSkillToLocal(): Promise<void> {
		if (!selectedSkillName || selectedSkillSource !== 'prototype') return;
		copyPrototypeLoading = true;
		try {
			const data = (await fetchJson('/api/prototype/skills/copy-to-local', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ skillName: selectedSkillName })
			})) as { copiedSkillName?: string };
			const copiedName =
				typeof data.copiedSkillName === 'string' ? data.copiedSkillName : selectedSkillName;
			activeSkillListTab = 'ladcraft';
			await loadLocalSkills(false);
			await loadLocalSkill(copiedName, { restoreDraftFromStore: false });
			setResult({ ok: true, copiedSkillName: copiedName });
		} catch (err) {
			setResult({ ok: false, error: err instanceof Error ? err.message : String(err) });
		} finally {
			copyPrototypeLoading = false;
		}
	}

	async function acceptServerVersion(): Promise<void> {
		if (!selectedSkillName) return;
		const selected = selectedLocalSkillMeta();
		const key = selected ? skillIdentityKey(selected) : `name:${selectedSkillName}`;
		const meta = remoteSkillsMeta[key];
		try {
			await fetchJson('/api/remote/skills/accept-server', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ skillName: selectedSkillName, skillId: meta?.id })
			});
			remoteSkillsMeta = {
				...remoteSkillsMeta,
				[key]: { ...(meta ?? { id: 0 }), hasConflict: false }
			};
			conflictDismissed = new Set(conflictDismissed);
			conflictDismissed.delete(key);
			await loadLocalSkill(selectedSkillName, { restoreDraftFromStore: false });
			setResult({ ok: true, message: 'Принята версия с сервера' });
		} catch (err) {
			setResult({ ok: false, error: err instanceof Error ? err.message : String(err) });
		}
	}

	function keepLocalAndMaybeDeploy(): void {
		if (!selectedSkillName) return;
		const selected = selectedLocalSkillMeta();
		const key = selected ? skillIdentityKey(selected) : `name:${selectedSkillName}`;
		conflictDismissed = new Set(conflictDismissed);
		conflictDismissed.add(key);
		showDeployAfterKeepLocal = true;
	}

	function closeDeployAfterKeepLocalModal(): void {
		showDeployAfterKeepLocal = false;
	}

	async function refreshListsAfterDeploy(): Promise<void> {
		refreshingListsAfterDeploy = true;
		try {
			if (healthInfo?.hasSkilledAgentToken) {
				await loadRemoteSkills(true);
			}
			await loadLocalSkills(true);
		} finally {
			refreshingListsAfterDeploy = false;
		}
	}

	async function loadRemotePublishedVersion(skillName: string): Promise<void> {
		remotePublishedVersion = null;
		const normalized = skillName.trim();
		if (!normalized || selectedSkillSource === 'prototype') return;
		try {
			const data = (await fetchJson(
				`/api/remote/skills/version-by-name?skillName=${encodeURIComponent(normalized)}`
			)) as { exists?: boolean; version?: string | null };
			if (data?.exists && typeof data.version === 'string' && data.version.trim()) {
				remotePublishedVersion = data.version.trim();
			}
		} catch {
			remotePublishedVersion = null;
		}
	}

	function buildDeployRequestBody(
		mode: 'create' | 'update' | 'upsert',
		options?: {
			skillId?: string;
			createAsName?: string;
			installationForm?: InstallationFormByTool;
		}
	): Record<string, unknown> {
		const body: Record<string, unknown> = {
			skillName: selectedSkillName,
			mode
		};
		if (options?.skillId) body.skillId = options.skillId;
		if (options?.createAsName) body.createAsName = options.createAsName;
		if (options?.installationForm && Object.keys(options.installationForm).length > 0) {
			body.installationForm = options.installationForm;
		}
		return body;
	}

	async function runDeployDryRun(
		mode: 'create' | 'update' | 'upsert',
		options?: { skillId?: string; createAsName?: string }
	): Promise<DeployPreflight | null> {
		if (!selectedSkillName) return null;
		deployPreflightLoading = true;
		try {
			const data = (await fetchJson('/api/remote/deploy-local/dry-run', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(buildDeployRequestBody(mode, options))
			})) as { preflight?: DeployPreflight };
			deployPreflight = data.preflight ?? null;
			return deployPreflight;
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			deployError = msg;
			return null;
		} finally {
			deployPreflightLoading = false;
		}
	}

	function buildPreflightConfirmText(preflight: DeployPreflight): string {
		const lines = [
			`Версия на сервере сейчас: ${preflight.currentVersion} (после публикации будет назначена Ladcraft)`,
			`Режим: ${preflight.targetAction}`,
			`Ошибки: ${preflight.validationReport.errors.length}`,
			`Warnings: ${preflight.validationReport.warnings.length}`,
			`Diff tools/env/widgets: ${preflight.diffSummary.tools.length}/${preflight.diffSummary.mcpSpecEnvironment.length}/${preflight.diffSummary.widgets.length}`,
			'Продолжить деплой?'
		];
		return lines.join('\n');
	}

	function formatValidationIssueBadge(issue: SkillValidationIssue): string {
		const code = issue.code != null ? ` ${issue.code}` : '';
		return `${issue.source}${code}`;
	}

	function formatValidationIssueLocation(issue: SkillValidationIssue): string {
		if (issue.filePath && issue.line != null && issue.column != null) {
			return `${issue.filePath}:${issue.line}:${issue.column}`;
		}
		return issue.filePath ?? 'skill';
	}

	function formatCompatibilityIssueBadge(issue: SkillCompatibilityIssue): string {
		return `${issue.source} ${issue.code}`;
	}

	function formatCompatibilityIssueLocation(issue: SkillCompatibilityIssue): string {
		if (issue.filePath && issue.line != null && issue.column != null) {
			return `${issue.filePath}:${issue.line}:${issue.column}`;
		}
		return issue.filePath ?? 'skill';
	}

	async function copyDeployValidationReport(): Promise<void> {
		if (!deployPreflight?.validationReport?.copyText || !navigator?.clipboard) {
			return;
		}
		deployValidationCopying = true;
		try {
			await navigator.clipboard.writeText(deployPreflight.validationReport.copyText);
			deployResult = { ok: true, message: 'Ошибки валидации скопированы.' };
		} catch (err) {
			deployError = err instanceof Error ? err.message : String(err);
		} finally {
			deployValidationCopying = false;
		}
	}

	async function copyCompatibilityReport(): Promise<void> {
		if (!compatibilityReport?.copyText || !navigator?.clipboard) {
			return;
		}
		compatibilityCopying = true;
		try {
			await navigator.clipboard.writeText(compatibilityReport.copyText);
			deployResult = { ok: true, message: 'Compatibility report скопирован.' };
		} catch (err) {
			deployError = err instanceof Error ? err.message : String(err);
		} finally {
			compatibilityCopying = false;
		}
	}

	async function loadDeployHistory(limit = 20): Promise<void> {
		if (!selectedSkillName) {
			deployHistory = [];
			return;
		}
		deployHistoryLoading = true;
		try {
			const data = (await fetchJson(
				`/api/remote/deploy-local/history?skillName=${encodeURIComponent(selectedSkillName)}&limit=${limit}`
			)) as { history?: DeployHistoryEntry[] };
			deployHistory = data.history ?? [];
		} catch {
			deployHistory = [];
		} finally {
			deployHistoryLoading = false;
		}
	}

	async function replayDeploy(historyId: number): Promise<void> {
		replayDeployLoading = true;
		try {
			const data = await fetchJson('/api/remote/deploy-local/replay', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ historyId })
			});
			deployResult = data;
			setResult(data);
			await loadDeployHistory();
			if (selectedSkillName) await loadRemotePublishedVersion(selectedSkillName);
		} catch (err) {
			deployError = err instanceof Error ? err.message : String(err);
		} finally {
			replayDeployLoading = false;
		}
	}

	async function runPostDeployChecks(): Promise<void> {
		if (!selectedSkillName) return;
		postDeployCheckLoading = true;
		try {
			const data = (await fetchJson('/api/remote/deploy-local/post-check', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ skillName: selectedSkillName })
			})) as {
				summary: { ok: number; warn: number; fail: number };
				checks: Array<{ id: string; status: 'ok' | 'warn' | 'fail'; message: string }>;
			};
			postDeployCheck = data;
		} catch (err) {
			deployError = err instanceof Error ? err.message : String(err);
		} finally {
			postDeployCheckLoading = false;
		}
	}

	function sendToGptzator(): void {
		if (selectedSkillSource === 'prototype') {
			setResult({
				ok: false,
				error:
					'Навык из прототипа нельзя отправить напрямую. Нажмите «Подготовить к конвертации», чтобы создать копию в Ladcraft.'
			});
			return;
		}
		if (!selectedSkillName || deploySending) return;
		if (sendDebounceTimerId) clearTimeout(sendDebounceTimerId);
		sendDebounceTimerId = window.setTimeout(() => {
			doSendToGptzator();
		}, 400);
	}

	async function doSendToGptzator(): Promise<void> {
		deployError = '';
		deployResult = null;
		deployModalOpen = false;
		existingSkillForDeploy = null;
		if (!healthInfo?.hasSkilledAgentToken) {
			remoteAuthExpired = true;
			authPanelOpen = true;
			const msg =
				'Нужна авторизация Ladcraft для выбранного окружения. Войдите через email/password или вставьте token.';
			deployError = msg;
			deployResult = { ok: false, error: msg };
			setResult({ ok: false, error: msg });
			return;
		}
		deploySending = true;
		try {
			const data = (await fetchJson('/api/remote/skills')) as {
				skills?: Array<{ id: string; name: string; identityKey?: string }>;
			};
			const remote = Array.isArray(data.skills) ? data.skills : [];
			remoteSkills = remote;
			const existing = remote.find((s) => s.name === formName.trim());
			if (existing) {
				existingSkillForDeploy = existing;
				deployModalOpen = true;
				return;
			}
			const envFields = collectInstallEnvFieldsFromMcp(currentMcpSpecObject());
			if (envFields.length > 0) {
				const savedDraft = selectedSkillName
					? await fetchSavedInstallFormDraftForSkill(selectedSkillName)
					: {};
				openInstallEnvModal(envFields, (form) => {
					void doDeploy('upsert', undefined, form);
				}, savedDraft);
				return;
			}
			await doDeploy('upsert');
		} catch (err) {
			const msg = markAuthExpiredFromError(err);
			deployError = msg;
			deployResult = { ok: false, error: msg };
			setResult({ ok: false, error: msg });
		} finally {
			deploySending = false;
		}
	}

	function closeDeployModal(): void {
		deployModalOpen = false;
		existingSkillForDeploy = null;
		deployCreateNewNameVisible = false;
		deployCreateNewName = '';
	}

	function openDeleteConfirm(skillName: string, e?: MouseEvent): void {
		e?.preventDefault();
		e?.stopPropagation();
		deleteConfirmSkillName = skillName;
	}

	function closeDeleteConfirm(): void {
		deleteConfirmSkillName = null;
	}

	async function confirmDeleteLocalSkill(): Promise<void> {
		const skillName = deleteConfirmSkillName;
		if (!skillName) return;
		closeDeleteConfirm();
		deleteSkillLoading = true;
		try {
			await fetchJson(`/api/local/skills/${encodeURIComponent(skillName)}`, { method: 'DELETE' });
			if (selectedSkillName === skillName) {
				selectedSkillName = '';
				formName = '';
				formDescription = '';
				formBody = '';
				scriptsJson = '[]';
				widgetsJson = '[]';
				mcpSpecJson = '{}';
			}
			await loadLocalSkills(false);
		} catch (err) {
			setResult({ ok: false, error: err instanceof Error ? err.message : String(err) });
		} finally {
			deleteSkillLoading = false;
		}
	}

	async function doDeploy(
		mode: 'create' | 'update' | 'upsert',
		createAsName?: string,
		installationForm?: InstallationFormByTool
	): Promise<void> {
		deployModalOpen = false;
		existingSkillForDeploy = null;
		deployCreateNewNameVisible = false;
		deployError = '';
		deployResult = null;
		deploySending = true;
		try {
			if (!selectedSkillName) {
				throw new Error('Не выбран локальный навык для деплоя');
			}
			const preflight = await runDeployDryRun(mode, {
				createAsName: mode === 'create' ? createAsName?.trim() : undefined
			});
			if (!preflight) return;
			if (preflight.validation.errors.length > 0) {
				// Полный список только в deployPreflight.validationReport. Не дублируем join в deployError — иначе «стена» и дубль с отчётом.
				deployError = '';
				deployResult = null;
				return;
			}
			if (!confirm(buildPreflightConfirmText(preflight))) {
				return;
			}
			const data = (await fetchJson('/api/remote/deploy-local', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(
					buildDeployRequestBody(mode, {
						createAsName: mode === 'create' ? createAsName?.trim() : undefined,
						installationForm
					})
				)
			})) as {
				ok?: boolean;
				conflict?: boolean;
				existing?: { id: string; name: string };
				error?: string;
			};
			if (data?.conflict === true && data?.existing) {
				existingSkillForDeploy = data.existing;
				deployModalOpen = true;
				deployResult = null;
				deployError = '';
			} else {
				remoteAuthExpired = false;
				deployResult = data;
				setResult(data);
				await loadDeployHistory();
				if (selectedSkillName) await loadRemotePublishedVersion(selectedSkillName);
			}
		} catch (err) {
			const msg = markAuthExpiredFromError(err);
			deployError = msg;
			deployResult = { ok: false, error: msg };
			setResult({ ok: false, error: msg });
		} finally {
			deploySending = false;
		}
	}

	async function fetchExistingInstallFormValuesForSkillId(
		skillId: string
	): Promise<InstallationFormByTool> {
		if (!skillId.trim()) return {};
		try {
			const data = (await fetchJson(
				`/api/remote/skills/${encodeURIComponent(skillId)}/installation-form-values`
			)) as { values?: InstallationFormByTool };
			return data?.values ?? {};
		} catch {
			return {};
		}
	}

	async function fetchSavedInstallFormDraftForSkill(
		skillName: string
	): Promise<InstallationFormByTool> {
		if (!skillName.trim()) return {};
		try {
			const data = (await fetchJson(
				`/api/local/skills/${encodeURIComponent(skillName)}/installation-form-draft`
			)) as { installationForm?: InstallationFormByTool };
			return data?.installationForm ?? {};
		} catch {
			return {};
		}
	}

	function mergeInstallationForms(
		base: InstallationFormByTool,
		override: InstallationFormByTool
	): InstallationFormByTool {
		const out: InstallationFormByTool = {};
		for (const [toolName, values] of Object.entries(base)) {
			out[toolName] = { ...values };
		}
		for (const [toolName, values] of Object.entries(override)) {
			out[toolName] = { ...(out[toolName] ?? {}), ...values };
		}
		return out;
	}

	async function deployOverwrite(): Promise<void> {
		if (!existingSkillForDeploy) return;
		const id = existingSkillForDeploy.id;
		const envFields = collectInstallEnvFieldsFromMcp(currentMcpSpecObject());
		if (envFields.length > 0) {
			const savedDraft = selectedSkillName
				? await fetchSavedInstallFormDraftForSkill(selectedSkillName)
				: {};
			const existingValues = await fetchExistingInstallFormValuesForSkillId(id);
			const initialValues = mergeInstallationForms(existingValues, savedDraft);
			openInstallEnvModal(
				envFields,
				(form) => {
					void runDeployLocalUpdate(id, form);
				},
				initialValues
			);
			return;
		}
		await runDeployLocalUpdate(id, undefined);
	}

	async function runDeployLocalUpdate(
		skillId: string,
		installationForm?: InstallationFormByTool
	): Promise<void> {
		existingSkillForDeploy = null;
		deployModalOpen = false;
		deployError = '';
		deployResult = null;
		deploySending = true;
		try {
			if (!selectedSkillName) {
				throw new Error('Не выбран локальный навык для деплоя');
			}
			const preflight = await runDeployDryRun('update', { skillId });
			if (!preflight) return;
			if (preflight.validation.errors.length > 0) {
				// Полный список только в deployPreflight.validationReport. Не дублируем join в deployError — иначе «стена» и дубль с отчётом.
				deployError = '';
				deployResult = null;
				return;
			}
			if (!confirm(buildPreflightConfirmText(preflight))) {
				return;
			}
			const data = await fetchJson('/api/remote/deploy-local', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(
					buildDeployRequestBody('update', {
						skillId,
						installationForm
					})
				)
			});
			remoteAuthExpired = false;
			deployResult = data;
			setResult(data);
			await loadDeployHistory();
			if (selectedSkillName) await loadRemotePublishedVersion(selectedSkillName);
		} catch (err) {
			const msg = markAuthExpiredFromError(err);
			deployError = msg;
			deployResult = { ok: false, error: msg };
			setResult({ ok: false, error: msg });
		} finally {
			deploySending = false;
		}
	}

	function deployCreateNew(): void {
		const base = formName.trim() || 'skill';
		deployCreateNewName = `${base}_copy`;
		deployCreateNewNameVisible = true;
	}

	async function deployCreateNewConfirm(): Promise<void> {
		const name = deployCreateNewName.trim();
		if (!name) return;
		closeDeployModal();
		const envFields = collectInstallEnvFieldsFromMcp(currentMcpSpecObject());
		if (envFields.length > 0) {
			const savedDraft = selectedSkillName
				? await fetchSavedInstallFormDraftForSkill(selectedSkillName)
				: {};
			openInstallEnvModal(envFields, (form) => {
				void doDeploy('create', name, form);
			}, savedDraft);
			return;
		}
		await doDeploy('create', name);
	}

	async function openWidgetFullscreen(): Promise<void> {
		widgetPreviewExpanded = true;
		await tick();
		// Режим «на весь экран страницы» (fixed overlay), без requestFullscreen,
		// чтобы крестик закрытия всегда был виден и не занимать весь экран монитора.
	}

	function closeWidgetFullscreen(): void {
		widgetPreviewExpanded = false;
	}

	onMount(() => {
		const onKeyDown = (e: KeyboardEvent): void => {
			if (e.key === 'Escape' && widgetPreviewExpanded) {
				closeWidgetFullscreen();
			}
		};
		const onVisibilityChange = (): void => {
			if (document.visibilityState === 'visible' && !sseConnected) {
				runQuietLocalListRefresh();
				runQuietPrototypeListRefresh();
			}
		};
		document.addEventListener('keydown', onKeyDown);
		document.addEventListener('visibilitychange', onVisibilityChange);
		connectSkillsEventSource();
		loadLocalSkills(false).catch((err) => {
			const msg = err instanceof Error ? err.message : String(err);
			listLoadError = msg;
			setResult({ ok: false, error: msg });
		});
		loadPrototypeSkills(false).catch(() => {});
		loadCapabilitiesCatalog().catch(() => {});
		refreshHealthInfo()
			.then((info) => {
				if (info?.bundleUpdateStatus?.state === 'running') {
					ensureBundleUpdatePolling();
				}
				if (info?.hasSkilledAgentToken) {
					return loadRemoteSkills(true);
				}
				remoteSkills = [];
				remoteSkillsMeta = {};
				return undefined;
			})
			.catch(() => {});
		return () => {
			document.removeEventListener('keydown', onKeyDown);
			document.removeEventListener('visibilitychange', onVisibilityChange);
			if (installEnvDraftSaveTimerId) clearTimeout(installEnvDraftSaveTimerId);
			if (mcpSpecDraftSaveTimerId) clearTimeout(mcpSpecDraftSaveTimerId);
			clearLocalSkillsPolling();
			clearBundleUpdatePolling();
			skillsEventSource?.close();
			skillsEventSource = null;
		};
	});
</script>

<main>
	<div class="page-header">
		<div class="page-title">
			<h1>Конструктор навыков</h1>
			<p class="small">
				Выберите навык слева, при необходимости отредактируйте и отправьте напрямую в Ladcraft.
			</p>
		</div>
		<div class="page-actions">
			<div class="page-actions-row">
				<button
					type="button"
					class="auth-chip"
					onclick={() => {
						authPanelOpen = true;
						clearManualTokenState();
					}}
				>
					<span>
						Вход в Ladcraft ({(healthInfo?.ladcraftEnv ?? 'dev').toUpperCase()})
					</span>
					<span class="small">Нажмите, чтобы открыть вход и настройки доступа</span>
					<span class="small">DEV: {authStatusLabel('dev')} · PROD: {authStatusLabel('prod')}</span>
				</button>

				<div class="page-top-links">
					<button type="button" class="top-link-button faq-link-button" onclick={openFaqModal}>
						FAQ
					</button>
					{#if healthInfo?.ladcraftReauthUrl}
						<a
							class="top-link-button"
							href={healthInfo.ladcraftReauthUrl}
							target="_blank"
							rel="noreferrer"
						>
							Открыть Ladcraft
						</a>
					{/if}
				</div>
			</div>

			{#if shouldShowBundleUpdateBanner()}
				<div class="bundle-version-banner" role="alert">
					<div class="bundle-version-banner-text">
						{#if isBundleUpdateRunning()}
							Идет автообновление cursor_ladcraft: {bundleUpdateStatus?.message}
						{:else if bundleUpdateStatus?.state === 'failed'}
							Автообновление завершилось ошибкой: {bundleUpdateStatus.lastError || bundleUpdateStatus.message}
						{:else if healthInfo?.cursorLadcraftBundleOutdated}
							Вышла новая версия Cursor Ladcraft. Можно обновить в один клик без ручной распаковки.
						{/if}
					</div>
					<div class="bundle-version-banner-actions">
						<button
							type="button"
							class="bundle-version-download-button with-loader"
							onclick={startBundleUpdate}
							disabled={bundleUpdateStarting || isBundleUpdateRunning()}
						>
							{#if bundleUpdateStarting}<span class="btn-loader" aria-hidden="true"></span>{/if}
							{bundleUpdateStarting ? 'Запуск...' : 'Обновить'}
						</button>
					</div>
				</div>
				{#if bundleUpdateError}
					<div class="small list-load-error">{bundleUpdateError}</div>
				{/if}
				{#if bundleUpdateStatus?.lastError}
					<div class="small list-load-error">{bundleUpdateStatus.lastError}</div>
				{/if}
			{/if}
		</div>
	</div>

	{#if skillsWithConflicts().length > 0}
		<div class="conflict-banner conflict-banner-global" role="alert">
			<p class="conflict-banner-text">
				У некоторых навыков локальная версия отличается от серверной: <strong
					>{skillsWithConflicts().join(', ')}</strong
				>. Выберите навык в списке слева и нажмите «Принять с сервера» или «Сохранить мои».
			</p>
		</div>
	{/if}

	<div class="layout">
		<section class="card sidebar">
			<div class="sidebar-head">
				<div class="sidebar-head-title">
					<h2>Навыки</h2>
					<div class="sidebar-help-tooltip">
						<button
							type="button"
							class="help-icon-button"
							aria-label="Подсказка по списку навыков"
							title="Показать подсказку"
						>
							?
						</button>
						<div class="help-tooltip" role="note">
							{#if activeSkillListTab === 'ladcraft'}
								Здесь показаны локальные навыки из папки <code>skills/</code>. Иконка облачка
								означает, что навык присутствует в выбранном удаленном окружении Ladcraft.
								«Обновить список» синхронизирует локальную папку с серверным списком
								активного окружения.
							{:else}
								Здесь показаны навыки прототипа из папки <code>skills_prototype/</code>.
								«Обновить список» синхронизирует локальную папку прототипов
								с актуальными данными из API и обновляет список.
							{/if}
						</div>
					</div>
				</div>
				<div class="tab-row">
					<button
						class:active-tab={activeSkillListTab === 'ladcraft'}
						onclick={() => (activeSkillListTab = 'ladcraft')}
					>
						Ladcraft
					</button>
					<button
						class:active-tab={activeSkillListTab === 'prototype'}
						onclick={() => (activeSkillListTab = 'prototype')}
					>
						Прототип
					</button>
				</div>
				{#if activeSkillListTab === 'ladcraft'}
					<div class="actions compact">
						<button
							class="with-loader"
							onclick={downloadFromServerAndRefreshLocal}
							disabled={downloadFromServerLoading || localListLoading || remoteListLoading || localSkillLoading}
						>
							{#if downloadFromServerLoading}<span class="btn-loader" aria-hidden="true"></span>{/if}
							{downloadFromServerLoading ? 'Обновление...' : 'Обновить список'}
						</button>
					</div>
				{:else}
					<div class="actions compact">
						<button
							class="with-loader"
							onclick={syncPrototypeSkills}
							disabled={syncPrototypeLoading || prototypeListLoading || prototypeSkillLoading}
						>
							{#if syncPrototypeLoading}<span class="btn-loader" aria-hidden="true"></span>{/if}
							{syncPrototypeLoading ? 'Обновление...' : 'Обновить список'}
						</button>
					</div>
				{/if}
			</div>
			{#if activeSkillListTab === 'prototype' && healthInfo?.prototypeTokenWarning}
				<div class="small deploy-warn">{healthInfo.prototypeTokenWarning}</div>
			{/if}
			<div class="skill-list">
				{#if activeSkillListTab === 'ladcraft'}
					{#if listLoadError}
						<div class="small list-load-error">{listLoadError}</div>
					{/if}
					{#if localSkills.length === 0}
						<div class="small">
							Список навыков из папки <code>skills/</code>. Нажмите «Обновить список», чтобы
							подгрузить. Навыки с сервера загружаются автоматически.
						</div>
					{:else}
						{#each localSkills as skill}
							<div
								class="skill-item {skill.name === selectedSkillName &&
								selectedSkillSource === 'ladcraft'
									? 'active'
									: ''}"
								class:disabled={isSkillListBusy()}
								role="button"
								tabindex="0"
								onclick={() => !isSkillListBusy() && loadLocalSkill(skill.name)}
								onkeydown={(e) =>
									(e.key === 'Enter' || e.key === ' ') &&
									!isSkillListBusy() &&
									loadLocalSkill(skill.name)}
							>
								<div class="skill-item-body">
									<div class="skill-item-title">
										{#if hasRemoteVersionForSkill(skill)}
											<span class="cloud-icon-wrapper" title="Навык загружен с сервера">
												<svg
													xmlns="http://www.w3.org/2000/svg"
													width="16"
													height="16"
													viewBox="0 0 24 24"
													fill="none"
													stroke="currentColor"
													stroke-width="2.4"
													stroke-linecap="round"
													stroke-linejoin="round"
													class="cloud-icon"
												>
													<path d="M17.5 19H8.8a5.8 5.8 0 1 1 1.1-11.5A4.8 4.8 0 0 1 19 9.4a3.9 3.9 0 0 1-1.5 9.6Z" />
												</svg>
											</span>
										{/if}
										{#if hasConflictForSkill(skill)}
											<span
												class="conflict-icon-wrapper"
												title="Локальная версия отличается от серверной"
											>
												<svg
													xmlns="http://www.w3.org/2000/svg"
													width="14"
													height="14"
													viewBox="0 0 24 24"
													fill="none"
													stroke="currentColor"
													stroke-width="2"
													stroke-linecap="round"
													stroke-linejoin="round"
													class="conflict-icon"
													><path d="M12 9v4" /><path d="M12 17h.01" /><circle
														cx="12"
														cy="12"
														r="10"
													/></svg
												>
											</span>
										{/if}
										{#if hasCompatibilityIssuesForSkill(skill)}
											<span
												class="compatibility-icon-wrapper"
												title={skill.compatibilitySummary?.summaryText ??
													'Есть предупреждения совместимости'}
											>
												!
											</span>
										{/if}
										{skill.name}
									</div>
									<div class="small">{skill.description}</div>
								</div>
								<button
									type="button"
									class="skill-item-delete"
									title="Удалить из папки skills"
									onclick={(e) => openDeleteConfirm(skill.name, e)}
									disabled={isSkillListBusy()}
									aria-label="Удалить навык"
								>
									<svg
										xmlns="http://www.w3.org/2000/svg"
										width="14"
										height="14"
										viewBox="0 0 24 24"
										fill="none"
										stroke="currentColor"
										stroke-width="2"
										><path d="M3 6h18" /><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" /><path
											d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"
										/><line x1="10" y1="11" x2="10" y2="17" /><line
											x1="14"
											y1="11"
											x2="14"
											y2="17"
										/></svg
									>
								</button>
							</div>
						{/each}
					{/if}
				{:else}
					{#if prototypeListLoadError}
						<div class="small list-load-error">{prototypeListLoadError}</div>
					{/if}
					{#if prototypeSkills.length === 0}
						<div class="small">
							Список навыков прототипа пуст. Нажмите «Обновить список», чтобы подтянуть
								навыки через API.
						</div>
					{:else}
						{#each prototypeSkills as skill}
							<div
								class="skill-item {skill.name === selectedSkillName &&
								selectedSkillSource === 'prototype'
									? 'active'
									: ''}"
								class:disabled={isSkillListBusy()}
								role="button"
								tabindex="0"
								onclick={() => !isSkillListBusy() && loadPrototypeSkill(skill.name)}
								onkeydown={(e) =>
									(e.key === 'Enter' || e.key === ' ') &&
									!isSkillListBusy() &&
									loadPrototypeSkill(skill.name)}
							>
								<div class="skill-item-body">
									<div class="skill-item-title">{skill.name}</div>
									<div class="small">{skill.description}</div>
								</div>
							</div>
						{/each}
					{/if}
				{/if}
			</div>
		</section>

		<section class="card test-area">
			{#if !isPrototypeSkillSelected() && activeTab === 'advanced' && selectedSkillHasConflict()}
				<div class="conflict-banner" role="alert">
					<p class="conflict-banner-text">Версии на сервере и локальные отличаются.</p>
					<div class="conflict-banner-actions">
						<button type="button" class="primary" onclick={acceptServerVersion}
							>Принять изменения с сервера</button
						>
						<button type="button" onclick={keepLocalAndMaybeDeploy}>Сохранить мои изменения</button>
					</div>
				</div>
			{/if}
			<div class="deploy-header">
				<div class="deploy-header-inner">
					<h3>
						{selectedSkillSource === 'prototype'
							? 'Конвертация навыка прототипа'
							: 'Отправить в Ladcraft'}
					</h3>
					<p class="small">
						{#if selectedSkillSource === 'prototype'}
							Для конвертации сначала создайте рабочую копию навыка в списке Ladcraft, затем
							адаптируйте её через агента.
						{:else}
							Выбранный навык отправится в Ladcraft. Если имя уже занято — предложим обновить существующий навык или
							создать копию.
						{/if}
					</p>
					{#if healthInfo?.hasSkilledAgentToken}
						<p class="small deploy-result">
							Ladcraft-сессия активна для {(healthInfo?.ladcraftEnv ?? 'dev').toUpperCase()}.
						</p>
					{:else if healthInfo}
						<p class="small deploy-warn">
							Ladcraft-сессия не активна для {(healthInfo?.ladcraftEnv ?? 'dev').toUpperCase()}.
							Войдите через email/password или вставьте access token вручную.
						</p>
					{/if}
					<div class="actions deploy-publish-row">
						{#if selectedSkillSource === 'prototype'}
							<button
								class="primary with-loader"
								onclick={copyPrototypeSkillToLocal}
								disabled={!selectedSkillName || copyPrototypeLoading}
							>
								{#if copyPrototypeLoading}<span class="btn-loader" aria-hidden="true"></span>{/if}
								{copyPrototypeLoading ? 'Подготовка...' : 'Подготовить к конвертации'}
							</button>
						{:else}
							<button
								class="primary with-loader publish-btn-compact"
								onclick={sendToGptzator}
								disabled={!selectedSkillName || deploySending || refreshingListsAfterDeploy}
							>
								{#if deploySending || refreshingListsAfterDeploy}<span
										class="btn-loader"
										aria-hidden="true"
									></span>{/if}
								{deploySending || refreshingListsAfterDeploy
									? 'Отправка...'
									: 'Опубликовать в Ladcraft'}
							</button>
						{/if}
					</div>
					{#if !isPrototypeSkillSelected() && selectedSkillName && remotePublishedVersion}
						<div class="small deploy-result">
							Текущая версия на сервере: {remotePublishedVersion}. Следующую версию назначает Ladcraft (локально не
							выбирается).
						</div>
					{/if}
					{#if deployError}
						<div class="deploy-error">{deployError}</div>
					{:else if deployResult !== null}
						<div class="deploy-result">
							{#if typeof deployResult === 'object' && deployResult !== null && (deployResult as { ok?: boolean }).ok}
								Готово.
							{:else}
								<div class="deploy-result-summary">
									{typeof deployResult === 'object' &&
									deployResult !== null &&
									typeof (deployResult as { error?: unknown }).error === 'string' &&
									String((deployResult as { error: string }).error).trim()
										? String((deployResult as { error: string }).error)
										: typeof deployResult === 'object' &&
											  deployResult !== null &&
											  typeof (deployResult as { message?: unknown }).message === 'string' &&
											  String((deployResult as { message: string }).message).trim()
											? String((deployResult as { message: string }).message)
											: 'Публикация не удалась. Полный ответ — во вложении.'}
								</div>
								<details class="deploy-response-details">
									<summary>Технические подробности ответа</summary>
									<pre class="deploy-response-pre">{JSON.stringify(deployResult, null, 2)}</pre>
								</details>
							{/if}
						</div>
					{/if}
					{#if deployPreflight?.validationReport}
						<div
							class={`validation-report ${deployPreflight.validationReport.isBlocking ? 'validation-report-error' : 'validation-report-warning'}`}
						>
							<div class="validation-report-header">
								<div>
									<strong>Отчёт валидации</strong>
									<div class="small">{deployPreflight.validationReport.summaryText}</div>
								</div>
								<button
									type="button"
									class="validation-report-copy-btn"
									onclick={copyDeployValidationReport}
									disabled={deployValidationCopying}
								>
									{deployValidationCopying ? 'Копирую...' : 'Копировать ошибки'}
								</button>
							</div>
							<details class="validation-report-details">
								<summary class="validation-report-details-summary">
									Подробный список ошибок и предупреждений
								</summary>
								<div class="validation-report-details-body">
									<p class="small validation-report-details-hint">
										Полный текст отчёта можно скопировать кнопкой «Копировать ошибки».
									</p>
									{#if deployPreflight.validationReport.isBlocking}
										<div class="small deploy-error" style="margin-top:8px;">
											Деплой заблокирован, пока не исправлены ошибки валидатора.
										</div>
									{/if}
									{#if deployPreflight.validationReport.errors.length > 0}
										<div class="validation-report-group">
											<div class="small"><strong>Errors</strong></div>
											{#each deployPreflight.validationReport.errors as issue, index (`error-${index}-${issue.filePath ?? issue.message}`)}
												<div class="validation-report-item">
													<div class="validation-report-meta">
														<span class="validation-report-badge">{formatValidationIssueBadge(issue)}</span>
														<code>{formatValidationIssueLocation(issue)}</code>
													</div>
													<div>{issue.message}</div>
												</div>
											{/each}
										</div>
									{/if}
									{#if deployPreflight.validationReport.warnings.length > 0}
										<div class="validation-report-group">
											<div class="small"><strong>Warnings</strong></div>
											{#each deployPreflight.validationReport.warnings as issue, index (`warning-${index}-${issue.filePath ?? issue.message}`)}
												<div class="validation-report-item">
													<div class="validation-report-meta">
														<span class="validation-report-badge">{formatValidationIssueBadge(issue)}</span>
														<code>{formatValidationIssueLocation(issue)}</code>
													</div>
													<div>{issue.message}</div>
												</div>
											{/each}
										</div>
									{/if}
								</div>
							</details>
						</div>
					{/if}
					{#if !isPrototypeSkillSelected() && selectedSkillName}
						{#if compatibilityReport && (compatibilityReport.errorCount > 0 || compatibilityReport.warningCount > 0)}
							<div
								class={`validation-report compatibility-report ${compatibilityReport.isBlocking ? 'validation-report-error' : 'validation-report-warning'}`}
							>
								<div class="validation-report-header">
									<div>
										<strong>Совместимость навыка</strong>
										<div class="small">{compatibilityReport.summaryText}</div>
										{#if compatibilityAuditMeta?.scannedAt}
											<div class="small validation-report-details-hint">
												Last scanned: {compatibilityAuditMeta.scannedAt}
											</div>
										{/if}
									</div>
									<button
										type="button"
										class="validation-report-copy-btn"
										onclick={copyCompatibilityReport}
										disabled={compatibilityCopying}
									>
										{compatibilityCopying ? 'Копирую...' : 'Копировать отчёт'}
									</button>
								</div>
								<details class="validation-report-details" open>
									<summary class="validation-report-details-summary">
										Подробный список совместимости
									</summary>
									<div class="validation-report-details-body">
										{#if compatibilityReport.errors.length > 0}
											<div class="validation-report-group">
												<div class="small"><strong>Errors</strong></div>
												{#each compatibilityReport.errors as issue, index (`compat-error-${index}-${issue.filePath ?? issue.message}`)}
													<div class="validation-report-item">
														<div class="validation-report-meta">
															<span class="validation-report-badge">{formatCompatibilityIssueBadge(issue)}</span>
															<code>{formatCompatibilityIssueLocation(issue)}</code>
														</div>
														<div>{issue.message}</div>
													</div>
												{/each}
											</div>
										{/if}
										{#if compatibilityReport.warnings.length > 0}
											<div class="validation-report-group">
												<div class="small"><strong>Warnings</strong></div>
												{#each compatibilityReport.warnings as issue, index (`compat-warning-${index}-${issue.filePath ?? issue.message}`)}
													<div class="validation-report-item">
														<div class="validation-report-meta">
															<span class="validation-report-badge">{formatCompatibilityIssueBadge(issue)}</span>
															<code>{formatCompatibilityIssueLocation(issue)}</code>
														</div>
														<div>{issue.message}</div>
													</div>
												{/each}
											</div>
										{/if}
									</div>
								</details>
							</div>
						{:else if compatibilityAuditMeta?.enabled}
							<div class="compatibility-ok small">
								<strong>Совместимость навыка:</strong> OK
								{#if compatibilityAuditMeta?.isRunning}
									<span> · checking...</span>
								{:else if selectedSkillCompatibilitySummary()?.scannedAt}
									<span> · scanned {selectedSkillCompatibilitySummary()?.scannedAt}</span>
								{:else if compatibilityAuditMeta?.scannedAt}
									<span> · scanned {compatibilityAuditMeta.scannedAt}</span>
								{/if}
							</div>
						{:else if compatibilityAuditMeta?.reason}
							<div class="small deploy-warn">
								Совместимость навыка пока недоступна: {compatibilityAuditMeta.reason}
							</div>
						{/if}
					{/if}
					{#if !isPrototypeSkillSelected() && selectedSkillName}
						<div class="tab-row editor-tabs-row">
							<button
								class:active-tab={activeTab === 'advanced'}
								onclick={() => (activeTab = 'advanced')}>Редактор</button
							>
							<button class:active-tab={activeTab === 'test'} onclick={() => (activeTab = 'test')}
								>Запуск и превью</button
							>
						</div>
						<div class="small deploy-result">
							<strong>Разрешения (capabilities.required)</strong>
							<div style="margin-top:6px;">
								<button
									type="button"
									onclick={addCapabilityRequirement}
									disabled={capabilityCatalogLoading || capabilityCatalog.length === 0}
								>
									+ добавить разрешение
								</button>
								<button
									type="button"
									style="margin-left:8px;"
									onclick={() => loadCapabilitiesCatalog()}
									disabled={capabilityCatalogLoading}
								>
									{capabilityCatalogLoading ? 'Обновляем...' : 'Обновить список'}
								</button>
							</div>
							{#if capabilityCatalogLoading}
								<div style="margin-top:6px;">Загрузка справочника разрешений...</div>
							{:else if capabilityCatalogWarning}
								<div class="small deploy-warn" style="margin-top:6px;">{capabilityCatalogWarning}</div>
							{/if}
							{#if capabilityCatalogSource}
								<div class="small" style="margin-top:4px;">
									Источник справочника: {capabilityCatalogSource === 'api'
										? 'Ladcraft API'
										: 'Ladcraft API'}.
								</div>
							{/if}
							{#if mcpDefaultCapabilities.length === 0}
								<div style="margin-top:6px;">
									Явные разрешения не заданы.
									{#if !capabilityCatalogLoading && capabilityCatalog.length === 0}
										Добавление недоступно, пока не загрузится каталог Ladcraft.
									{/if}
								</div>
							{:else}
								{#each mcpDefaultCapabilities as row, idx (`cap:${idx}:${row.type}`)}
									<div style="margin-top:8px; border-top:1px solid #dbe7f6; padding-top:8px;">
										<div
											class="small"
											style="display:grid; grid-template-columns: 1fr 220px auto; gap:6px; margin-bottom:4px;"
										>
											<div><strong>Тип разрешения</strong></div>
											<div><strong>Область доступа</strong></div>
											<div><strong>Действие</strong></div>
										</div>
										<div style="display:grid; grid-template-columns: 1fr 220px auto; gap:6px;">
											<select
												value={row.type}
												onchange={(e) =>
													updateCapabilityType(
														idx,
														(e.currentTarget as HTMLSelectElement).value
													)}
											>
												{#each capabilityCatalog as item (`cap-type:${item.type}`)}
													<option value={item.type}>{item.label && item.label !== item.type ? `${item.label} (${item.type})` : item.type}</option>
												{/each}
											</select>
											<select
												value={row.scope}
												onchange={(e) =>
													updateCapabilityScope(
														idx,
														(e.currentTarget as HTMLSelectElement).value
													)}
											>
												{#each scopesForType(row.type) as scopeValue (`scope:${row.type}:${scopeValue}`)}
													<option value={scopeValue}>{scopeValue}</option>
												{/each}
											</select>
											<button type="button" onclick={() => removeCapabilityRequirement(idx)}>
												удалить
											</button>
										</div>
										<div style="margin-top:6px;">
											<div class="small" style="margin-bottom:4px;">
												{capabilityLabel(row.type)}
												{#if capabilityDescription(row.type)}
													: {capabilityDescription(row.type)}
												{/if}
											</div>
											<label>
												Разрешённые операции
												<select
													onchange={(e) => {
														const val = (e.currentTarget as HTMLSelectElement).value;
														if (val) addCapabilityOperation(idx, val);
														(e.currentTarget as HTMLSelectElement).value = '';
													}}
												>
													<option value="">Добавить операцию...</option>
													{#each operationsForType(row.type) as op (`op:${row.type}:${op}`)}
														<option value={op} disabled={operationSelected(idx, op)}>
															{operationDescription(row.type, op)
																? `${op} - ${operationDescription(row.type, op)}`
																: op}
														</option>
													{/each}
												</select>
											</label>
											<div style="display:flex; flex-wrap:wrap; gap:6px; margin-top:6px;">
												{#if row.operations.length === 0}
													<span class="small">Операции не выбраны.</span>
												{:else}
													{#each row.operations as selectedOp (`selected-op:${idx}:${selectedOp}`)}
														<div
															style="display:flex; align-items:center; gap:6px; border:1px solid #dbe7f6; border-radius:6px; padding:4px 6px; background:#fff;"
														>
															<button
																type="button"
																title="Убрать операцию"
																onclick={() => removeCapabilityOperation(idx, selectedOp)}
															>
																{selectedOp} ×
															</button>
															{#if operationDescription(row.type, selectedOp)}
																<span class="small">{operationDescription(row.type, selectedOp)}</span>
															{/if}
														</div>
													{/each}
												{/if}
											</div>
										</div>
									</div>
								{/each}
							{/if}

							<div style="margin-top:12px;">
							<strong>Глобальные переменные (environment.app)</strong>
							{#if mcpEnvironmentByTool.length === 0}
								<div style="margin-top:6px;">Инструменты не найдены в MCP spec.</div>
							{:else}
								{#each listMergedAppEnvRows() as row (`app:${row.key}`)}
									<div style="margin-top:8px; border-top:1px solid #dbe7f6; padding-top:8px;">
										<div style="display:grid; grid-template-columns: 1fr 1fr auto; gap:6px;">
											<input value={row.key} disabled />
											<input
												value={row.value}
												placeholder={row.hasMixedValues ? 'значения различаются' : 'значение'}
												oninput={(e) =>
													upsertEnvironmentAppFieldForAllToolsByKey(
														row.key,
														(e.currentTarget as HTMLInputElement).value
													)}
											/>
											<button
												type="button"
												onclick={() => removeEnvironmentAppFieldForAllToolsByKey(row.key)}
											>
												убрать везде
											</button>
										</div>
										<div class="small" style="margin-top:4px;">
											Скрипты: {row.toolNames.join(', ')}
										</div>
									</div>
								{/each}
								{#if !hasMcpAppEnv}
									<div style="margin-top:6px;">Глобальных переменных нет.</div>
								{/if}
							{/if}

							<div style="margin-top:12px;">
								<strong>Переменные пользователя (environment.user)</strong>
								{#if mcpEnvironmentByTool.length === 0}
									<div style="margin-top:6px;">Инструменты не найдены в MCP spec.</div>
								{:else}
									{#each listMergedUserEnvRows() as row (`user:${row.key}`)}
										<div style="margin-top:8px; border-top:1px solid #dbe7f6; padding-top:8px;">
											<div style="display:grid; grid-template-columns: 1fr 1fr 120px auto; gap:6px;">
												<input value={row.key} disabled />
												<input
													value={row.title}
													placeholder={row.hasMixedTitle ? 'названия различаются' : ''}
													oninput={(e) =>
														upsertEnvironmentUserFieldForAllToolsByKey(row.key, {
															title: (e.currentTarget as HTMLInputElement).value
														})}
												/>
												<select
													value={row.format}
													onchange={(e) =>
														upsertEnvironmentUserFieldForAllToolsByKey(row.key, {
															format: (e.currentTarget as HTMLSelectElement).value
														})}
												>
													<option value="string">string</option>
													<option value="number">number</option>
													<option value="boolean">boolean</option>
													<option value="email">email</option>
													<option value="uri">uri</option>
												</select>
												<button
													type="button"
													onclick={() => removeEnvironmentUserFieldForAllToolsByKey(row.key)}
												>
													убрать везде
												</button>
											</div>
											<div class="small" style="margin-top:4px;">
												Скрипты: {row.toolNames.join(', ')}
											</div>
										</div>
									{/each}
									{#if !hasMcpUserEnv}
										<div style="margin-top:6px;">
											Переменных пользователя нет.
										</div>
									{/if}
								{/if}
							</div>
							</div>
						</div>
					{/if}
				</div>
			</div>

			{#if !isPrototypeSkillSelected()}
				{#if activeTab === 'test'}
					<h2>Запуск скрипта</h2>
					{#if scriptNames().length === 0}
						<p class="small hint instruction-only">
							Этот навык не содержит скриптов — это <strong>навык-инструкция</strong> для агента. Запуск
							скриптов и превью виджета недоступны. Редактирование и деплой доступны во вкладке «Редактор»
							и через «Отправить в Ladcraft».
						</p>
						<div class="empty-widget">Превью виджета недоступно (у навыка нет скриптов).</div>
					{:else}
						<label>
							Скрипт
							<select
								value={selectedScriptName}
								onchange={(e) => onScriptChange((e.target as HTMLSelectElement).value)}
							>
								<option value="">Выберите скрипт</option>
								{#each scriptNames() as scriptName}
									<option value={scriptName}>{scriptName}</option>
								{/each}
							</select>
						</label>

						{@const currentScript = selectedScript()}
						{@const inputSchema = currentScript?.input_schema as
							| { type?: string; properties?: Record<string, unknown>; required?: string[] }
							| undefined}

						{#if selectedScriptName && inputSchema && inputSchema.properties}
							<div class="script-form">
								<h3>Параметры скрипта</h3>
								<p class="small script-help">
									Это входной объект <code>input</code> для выбранного скрипта (по
									<code>input_schema</code>). Обязательные поля отмечены, остальные — опциональны.
								</p>
								{#each Object.entries(inputSchema.properties) as [key, prop]}
									{@const propSchema = prop as {
										type?: string;
										description?: string;
										default?: unknown;
										properties?: Record<string, unknown>;
										items?: unknown;
										required?: string[];
									}}
									{@const isRequired = inputSchema.required?.includes(key) ?? false}
									<SchemaFormField
										keyName={key}
										schema={propSchema}
										value={scriptInputData[key]}
										required={isRequired}
										path={[key]}
										onUpdate={setFormDataAtPath}
									/>
								{/each}
							</div>
						{:else if selectedScriptName}
							<p class="small hint">
								У выбранного скрипта нет input_schema или он пустой. Скрипт будет запущен без
								параметров.
							</p>
						{:else}
							<p class="small hint">Выберите скрипт для отображения формы параметров.</p>
						{/if}

						<details class="json-editor-fallback">
							<summary>Редактор JSON (для продвинутых)</summary>
							<p class="small script-help">
								Если удобнее, можно ввести параметры вручную в JSON. Этот объект будет передан в
								скрипт как <code>input</code>. Синхронизируется с формой выше.
							</p>
							<label>
								Параметры (JSON)
								<textarea
									value={scriptInputJson}
									oninput={(e) => {
										scriptInputJson = (e.currentTarget as HTMLTextAreaElement).value;
									}}
									onblur={() => {
										try {
											const parsed = scriptInputJson.trim() ? JSON.parse(scriptInputJson) : {};
											if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
												scriptInputData = parsed;
											}
										} catch {
											// при невалидном JSON оставляем scriptInputData как есть
										}
									}}
								></textarea>
							</label>
						</details>
						<div class="actions">
							<button
								class="primary with-loader"
								onclick={() => runLocalScript()}
								disabled={runScriptLoading || !selectedScriptName}
							>
								{#if runScriptLoading}<span class="btn-loader" aria-hidden="true"></span>{/if}
								{runScriptLoading ? 'Запуск...' : 'Запустить'}
							</button>
						</div>

						<div class="widget-preview-header">
							<h3 class="section-title">Превью виджета {widgetName ? `(${widgetName})` : ''}</h3>
							{#if widgetHtml}
								<button
									type="button"
									class="widget-expand-btn"
									title="Открыть виджет на весь экран"
									onclick={openWidgetFullscreen}
									aria-label="Открыть виджет на весь экран"
								>
									<svg
										xmlns="http://www.w3.org/2000/svg"
										width="18"
										height="18"
										viewBox="0 0 24 24"
										fill="none"
										stroke="currentColor"
										stroke-width="2"
										stroke-linecap="round"
										stroke-linejoin="round"
										><path d="M8 3H5a2 2 0 0 0-2 2v3" /><path d="M21 8V5a2 2 0 0 0-2-2h-3" /><path
											d="M3 16v3a2 2 0 0 0 2 2h3"
										/><path d="M16 21h3a2 2 0 0 0 2-2v-3" /></svg
									>
								</button>
							{/if}
						</div>
						{#if widgetHtml}
							<iframe
								class="widget-frame"
								title="Превью виджета"
								srcdoc={widgetHtml}
								sandbox="allow-scripts allow-same-origin"
							></iframe>
						{:else}
							<div class="empty-widget">Запустите скрипт с виджетом, чтобы увидеть превью.</div>
						{/if}
					{/if}

					<details
						class="output-details"
						open={outputDetailsOpen}
						ontoggle={(e) => (outputDetailsOpen = (e.currentTarget as HTMLDetailsElement).open)}
					>
						<summary>Ответ скрипта (JSON)</summary>
						<pre>{output || 'Пока нет результата'}</pre>
					</details>

					<details class="output-details">
						<summary>Логи ({logs.length})</summary>
						<pre>{logs.length ? logs.join('\n') : 'Логов пока нет'}</pre>
					</details>
				{:else}
					<details open>
						<summary>Редактор навыка</summary>
						<label>
							Название
							<input bind:value={formName} />
						</label>
						<label>
							Описание
							<input bind:value={formDescription} />
						</label>
						<label>
							Инструкция (body)
							<textarea bind:value={formBody}></textarea>
						</label>
						{#if scriptNames().length > 0}
							<label>
								Скрипт для редактирования ресурсов
								<select
									value={selectedScriptName}
									onchange={(e) => onScriptChange((e.target as HTMLSelectElement).value)}
								>
									<option value="">Выберите скрипт</option>
									{#each scriptNames() as scriptName}
										<option value={scriptName}>{scriptName}</option>
									{/each}
								</select>
							</label>
							{@const editorScript = selectedScript()}
							{@const editorResources = scriptResourcesForEditor(editorScript)}
							{#if selectedScriptName && editorScript}
								<div class="small deploy-result" style="margin-top:8px;">
									<strong>Ресурсы скрипта ({selectedScriptName})</strong>
									<div class="small" style="margin-top:4px;">
										Значения сохраняются в <code>scripts/*.script.md</code> (поле <code>resources</code>).
									</div>
									<div
										style="display:grid; grid-template-columns: repeat(2, minmax(140px, 1fr)); gap:8px; margin-top:8px;"
									>
										<label style="margin:0;">
											CPU
											<input
												type="number"
												step="0.1"
												min="0"
												max="16"
												placeholder="0.2"
												value={editorResources.cpu}
												oninput={(e) =>
													updateSelectedScriptResourceNumber(
														'cpu',
														(e.currentTarget as HTMLInputElement).value
													)}
											/>
											<div class="small" style="margin-top:4px;">
												Число `>= 0`, шаг `0.1`. Рекомендуемый диапазон: `0.1-2`.
											</div>
										</label>
										<label style="margin:0;">
											GPU
											<input
												type="number"
												step="0.1"
												min="0"
												max="8"
												placeholder="0"
												value={editorResources.gpu}
												oninput={(e) =>
													updateSelectedScriptResourceNumber(
														'gpu',
														(e.currentTarget as HTMLInputElement).value
													)}
											/>
											<div class="small" style="margin-top:4px;">
												Число `>= 0`, шаг `0.1`. Обычно `0` (GPU не нужен) или `1`.
											</div>
										</label>
										<label style="margin:0;">
											Memory
											<input
												type="number"
												step="1"
												min="0"
												max="65536"
												placeholder="128"
												value={editorResources.memory}
												oninput={(e) =>
													updateSelectedScriptResourceNumber(
														'memory',
														(e.currentTarget as HTMLInputElement).value
													)}
											/>
											<div class="small" style="margin-top:4px;">
												Целое число (MB), `>= 0`. Рекомендуемый диапазон: `128-2048`.
											</div>
										</label>
										<label style="margin:0;">
											Timeout (sec)
											<input
												type="number"
												step="1"
												min="0"
												max="3600"
												placeholder="30"
												value={editorResources.timeout}
												oninput={(e) =>
													updateSelectedScriptResourceNumber(
														'timeout',
														(e.currentTarget as HTMLInputElement).value
													)}
											/>
											<div class="small" style="margin-top:4px;">
												Целое число в секундах, `>= 0`. Рекомендуемый диапазон: `10-300`.
											</div>
										</label>
									</div>
									<label style="margin-top:8px;">
										Network hosts (по одному хосту в строке или через запятую)
										<textarea
											rows="4"
											placeholder="api.example.com&#10;cdn.example.com"
											value={editorResources.networkHosts}
											oninput={(e) =>
												updateSelectedScriptNetworkHosts(
													(e.currentTarget as HTMLTextAreaElement).value
												)}
										></textarea>
										<div class="small" style="margin-top:4px;">
											Только hostname без `https://` и без пути. Пример: `api.example.com`.
										</div>
									</label>
								</div>
							{/if}
						{/if}
						<div class="actions">
							<button
								class="primary with-loader"
								onclick={saveLocalSkill}
								disabled={saveSkillLoading}
							>
								{#if saveSkillLoading}<span class="btn-loader" aria-hidden="true"></span>{/if}
								{saveSkillLoading ? 'Сохранение...' : 'Сохранить'}
							</button>
						</div>
					</details>
				{/if}
			{/if}
		</section>
	</div>

	{#if authPanelOpen}
		<div
			class="modal-backdrop"
			role="dialog"
			aria-modal="true"
			aria-labelledby="auth-modal-title"
		>
			<div class="modal modal-wide auth-modal">
				<div class="modal-header-row">
					<h3 id="auth-modal-title">Авторизация Ladcraft</h3>
					<button type="button" class="modal-close-btn" onclick={() => (authPanelOpen = false)}>×</button>
				</div>

				<div class="auth-modal-meta">
					<div>
						Активная среда:
						<strong>{(healthInfo?.ladcraftEnv ?? 'dev').toUpperCase()}</strong>
					</div>
					<div class="auth-status-grid">
						<div class="auth-status-item" class:online={authStatusForEnv('dev')}>DEV: {authStatusLabel('dev')}</div>
						<div class="auth-status-item" class:online={authStatusForEnv('prod')}>
							PROD: {authStatusLabel('prod')}
						</div>
					</div>
				</div>

				{#if remoteAuthExpired}
					<div class="deploy-warn" role="alert">
						<div>Токен Ladcraft для {(healthInfo?.ladcraftEnv ?? 'dev').toUpperCase()} истек или недействителен.</div>
						<div class="small auth-inline-hint">
							{healthInfo?.ladcraftTokenRefreshHint ??
								'Войдите через email и пароль или обновите токен вручную.'}
						</div>
					</div>
				{/if}

				<div class="auth-section-title">Окружение</div>
				<div class="auth-env-switch" role="group" aria-label="Выбор окружения Ladcraft">
					<button
						type="button"
						class="with-loader auth-env-btn"
						class:active={healthInfo?.ladcraftEnv === 'dev'}
						onclick={() => switchLadcraftEnvironment('dev')}
						disabled={envSwitching || healthInfo?.ladcraftEnv === 'dev'}
					>
						{healthInfo?.ladcraftEnv === 'dev' ? '✓ DEV' : 'DEV'}
					</button>
					<button
						type="button"
						class="with-loader auth-env-btn"
						class:active={healthInfo?.ladcraftEnv === 'prod'}
						onclick={() => switchLadcraftEnvironment('prod')}
						disabled={envSwitching || healthInfo?.ladcraftEnv === 'prod'}
					>
						{healthInfo?.ladcraftEnv === 'prod' ? '✓ PROD' : 'PROD'}
					</button>
				</div>

				<div class="auth-section-title">Вход через email и пароль</div>
				<label>
					Email
					<input
						id="ladcraft-auth-email"
						name="username"
						type="email"
						autocomplete="username"
						inputmode="email"
						autocapitalize="none"
						spellcheck="false"
						placeholder="you@example.com"
						bind:value={authEmail}
						oninput={clearManualTokenState}
					/>
				</label>
				<label>
					Пароль
					<input
						id="ladcraft-auth-password"
						name="current-password"
						type="password"
						autocomplete="current-password"
						placeholder="Введите пароль Ladcraft"
						bind:value={authPassword}
						oninput={clearManualTokenState}
					/>
				</label>
				<div class="actions compact auth-submit-row">
					<button
						type="button"
						class="primary with-loader auth-submit"
						onclick={loginByCredentials}
						disabled={authLoginLoading || !authEmail.trim() || !authPassword.trim()}
					>
						{#if authLoginLoading}<span class="btn-loader" aria-hidden="true"></span>{/if}
						{authLoginLoading ? 'Входим...' : 'Войти в Ladcraft'}
					</button>
				</div>
				{#if authLoginError}
					<div class="deploy-error auth-inline-error">{authLoginError}</div>
				{/if}

				<div class="auth-section-title">Ручная вставка токена</div>
				<label>
					Новый access token
					<input
						type="password"
						placeholder="Вставьте token"
						bind:value={manualToken}
						oninput={clearManualTokenState}
					/>
				</label>
				<div class="actions compact auth-submit-row">
					<button
						type="button"
						class="primary with-loader auth-submit"
						onclick={saveManualToken}
						disabled={manualTokenUpdating || !manualToken.trim()}
					>
						{#if manualTokenUpdating}<span class="btn-loader" aria-hidden="true"></span>{/if}
						{manualTokenUpdating ? 'Сохраняем...' : 'Сохранить токен'}
					</button>
				</div>
				{#if manualTokenError}
					<div class="deploy-error auth-inline-error">{manualTokenError}</div>
				{/if}

				{#if authLogoutError}
					<div class="deploy-error auth-inline-error">{authLogoutError}</div>
				{/if}

				<div class="auth-logout-section">
					<div class="auth-section-title auth-logout-title">Выход из окружений</div>
					<div class="actions compact auth-logout-actions">
						<button
							type="button"
							class="with-loader danger"
							onclick={() => logoutFromLadcraftEnvironment('dev')}
							disabled={authLogoutLoadingEnv !== null || !authStatusForEnv('dev')}
						>
							{#if authLogoutLoadingEnv === 'dev'}<span class="btn-loader" aria-hidden="true"></span>{/if}
							{authLogoutLoadingEnv === 'dev' ? 'Выходим из DEV...' : 'Выйти из DEV'}
						</button>
						<button
							type="button"
							class="with-loader danger"
							onclick={() => logoutFromLadcraftEnvironment('prod')}
							disabled={authLogoutLoadingEnv !== null || !authStatusForEnv('prod')}
						>
							{#if authLogoutLoadingEnv === 'prod'}<span class="btn-loader" aria-hidden="true"></span>{/if}
							{authLogoutLoadingEnv === 'prod' ? 'Выходим из PROD...' : 'Выйти из PROD'}
						</button>
					</div>
				</div>
			</div>
		</div>
	{/if}

	{#if faqModalOpen}
		<div
			class="modal-backdrop"
			role="dialog"
			aria-modal="true"
			aria-labelledby="faq-modal-title"
			tabindex="-1"
			onclick={(event) => {
				if (event.target === event.currentTarget) closeFaqModal();
			}}
			onkeydown={(event) => {
				if (event.key === 'Escape') closeFaqModal();
			}}
		>
			<div class="modal modal-wide faq-modal">
				<div class="modal-header-row">
					<h3 id="faq-modal-title">FAQ по cursor_ladcraft</h3>
					<button type="button" class="modal-close-btn" onclick={closeFaqModal}>x</button>
				</div>
				<p class="small">Инструкция основана на кнопках и сценариях, которые есть в этом интерфейсе.</p>

				<div class="faq-scroll">
					<details>
						<summary>1) Где что находится в интерфейсе</summary>
						<ul class="faq-list">
							<li>Левая панель: выбор навыка и синхронизация списков.</li>
							<li>«Редактор»: правка файлов навыка.</li>
							<li>«Запуск и превью»: запуск скрипта и просмотр виджета.</li>
							<li>Блок деплоя: публикация в Ladcraft и обработка конфликтов.</li>
						</ul>
					</details>

					<details>
						<summary>2) Авторизация в Ladcraft</summary>
						<ol class="faq-list">
							<li>Нажмите кнопку со статусом <strong>Ladcraft DEV/PROD</strong> в шапке.</li>
							<li>В модалке «Авторизация Ladcraft» используйте «Войти в Ladcraft» или «Сохранить токен».</li>
							<li>Если сессия не активна, в блоке деплоя появится предупреждение.</li>
						</ol>
					</details>

					<details>
						<summary>3) Смена окружения DEV/PROD и logout</summary>
						<ol class="faq-list">
							<li>Откройте модалку «Авторизация Ladcraft».</li>
							<li>Нажмите <strong>DEV</strong> или <strong>PROD</strong> для переключения.</li>
							<li>При необходимости используйте «Выйти из DEV» или «Выйти из PROD».</li>
							<li>Перед публикацией проверьте активное окружение в шапке.</li>
						</ol>
					</details>

					<details>
						<summary>4) Что означает баннер «Требуется обновление cursor_ladcraft»</summary>
						<ul class="faq-list">
							<li>Баннер показывает расхождение локальной версии и версии из прототипа.</li>
							<li>В тексте баннера отображаются обе версии: локальная и удаленная.</li>
							<li>Нажмите «Обновить» — launcher применит новую версию автоматически.</li>
							<li>Папка <code>skills/</code> не входит в backup/update, локальные черновики сохраняются.</li>
							<li>Папка <code>user-data/</code> тоже сохраняется и не входит в backup/update.</li>
							<li>Корневая папка <code>.git</code> не удаляется при update/rollback.</li>
						</ul>
					</details>

					<details>
						<summary>5) Синхронизация навыков из Ladcraft</summary>
						<ol class="faq-list">
							<li>Откройте вкладку <strong>Ladcraft</strong>.</li>
							<li>Нажмите «Обновить список» для синхронизации папки <code>skills/</code> с серверным списком активного окружения.</li>
							<li>При конфликте выберите «Принять с сервера» или «Сохранить мои изменения».</li>
						</ol>
					</details>

					<details>
						<summary>6) Синхронизация навыков из прототипа</summary>
						<ol class="faq-list">
							<li>Откройте вкладку <strong>Прототип</strong>.</li>
							<li>Нажмите «Обновить список» для обновления <code>skills_prototype/</code> через API.</li>
							<li>Для дальнейшей публикации нажмите «Подготовить к конвертации».</li>
							<li>После подготовки работайте с копией во вкладке Ladcraft.</li>
						</ol>
					</details>

					<details>
						<summary>7) Редактирование и запуск</summary>
						<ul class="faq-list">
							<li>Файлы навыка меняются во вкладке «Редактор», затем «Сохранить».</li>
							<li>Запуск выполняется во вкладке «Запуск и превью» кнопкой «Запустить».</li>
							<li>Для instruction-only навыков запуск скрипта и превью недоступны (это показывается в интерфейсе).</li>
						</ul>
					</details>

					<details>
						<summary>8) Публикация в Ladcraft (текущий flow)</summary>
						<ol class="faq-list">
							<li>
								Версия на сервере обновляется на стороне Ladcraft; в workbench тип semver (patch/minor/major) не
								выбирается.
							</li>
							<li>Нажмите «Опубликовать в Ladcraft».</li>
							<li>Если навык уже существует, в модалке выберите «Обновить существующий навык» или «Создать копию».</li>
							<li>Для копии задайте имя и подтвердите «Деплой копии».</li>
						</ol>
					</details>

					<details>
						<summary>9) Модалка «Параметры установки навыка»</summary>
						<ul class="faq-list">
							<li>После deploy может открыться модалка «Параметры установки навыка».</li>
							<li>В ней заполняются пользовательские переменные <code>environment.user</code> из MCP spec.</li>
							<li>Часть значений может подставляться автоматически, если они уже есть у установленного навыка.</li>
							<li>Далее нажмите «Продолжить» или «Отмена».</li>
						</ul>
					</details>

					<details>
						<summary>10) Частые ситуации</summary>
						<ul class="faq-list">
							<li><strong>401/403:</strong> обновите авторизацию в модалке «Авторизация Ladcraft».</li>
							<li><strong>Конфликт версии:</strong> используйте «Принять с сервера» или «Сохранить мои изменения».</li>
							<li><strong>Прототип не публикуется напрямую:</strong> сначала «Подготовить к конвертации».</li>
							<li><strong>Нет превью виджета:</strong> запустите скрипт и проверьте, что он возвращает виджет.</li>
						</ul>
					</details>
				</div>
			</div>
		</div>
	{/if}

	{#if authFailureModalMessage}
		<div
			class="modal-backdrop"
			role="dialog"
			aria-modal="true"
			aria-labelledby="auth-failure-modal-title"
		>
			<div class="modal">
				<h3 id="auth-failure-modal-title">{authFailureModalTitle}</h3>
				<p class="small">{authFailureModalMessage}</p>
				<div class="actions">
					<button type="button" class="primary" onclick={closeAuthFailureModal}>Понятно</button>
				</div>
			</div>
		</div>
	{/if}

	{#if deleteConfirmSkillName}
		<div
			class="modal-backdrop"
			role="dialog"
			aria-modal="true"
			aria-labelledby="delete-modal-title"
		>
			<div class="modal">
				<h3 id="delete-modal-title">Удалить навык?</h3>
				<p class="small">
					Навык «{deleteConfirmSkillName}» будет удалён из папки <code>skills/</code>. Отменить
					действие нельзя.
				</p>
				<div class="actions">
					<button
						type="button"
						class="primary danger with-loader"
						onclick={confirmDeleteLocalSkill}
						disabled={deleteSkillLoading}
					>
						{#if deleteSkillLoading}<span class="btn-loader" aria-hidden="true"></span>{/if}
						{deleteSkillLoading ? 'Удаление...' : 'Удалить'}
					</button>
					<button type="button" onclick={closeDeleteConfirm} disabled={deleteSkillLoading}
						>Отмена</button
					>
				</div>
			</div>
		</div>
	{/if}

	{#if deployModalOpen && existingSkillForDeploy}
		{@const existing = existingSkillForDeploy}
		<div
			class="modal-backdrop"
			role="dialog"
			aria-modal="true"
			aria-labelledby="deploy-modal-title"
		>
			<div class="modal" class:modal-wide={deployCreateNewNameVisible}>
				{#if deployCreateNewNameVisible}
					<h3 id="deploy-modal-title">Имя для копии на сервере</h3>
					<p class="small">Будет создан новый навык с этим именем. Локальный файл не меняется.</p>
					<label>
						Имя
						<input
							type="text"
							bind:value={deployCreateNewName}
							placeholder="например my_skill_copy"
						/>
					</label>
					<div class="actions">
						<button
							class="primary with-loader"
							onclick={deployCreateNewConfirm}
							disabled={deploySending || !deployCreateNewName.trim()}
						>
							{#if deploySending}<span class="btn-loader" aria-hidden="true"></span>{/if}
							{deploySending ? 'Отправка...' : 'Деплой копии'}
						</button>
						<button
							type="button"
							onclick={() => {
								deployCreateNewNameVisible = false;
								deployCreateNewName = '';
							}}
							disabled={deploySending}>Назад</button
						>
					</div>
				{:else}
					<h3 id="deploy-modal-title">Навык уже существует в Ladcraft</h3>
					<p class="small">
						На сервере есть навык «{existing.name}» (ID {existing.id}). Выберите действие:
					</p>
					<div class="actions">
						<button class="primary with-loader" onclick={deployOverwrite} disabled={deploySending}>
							{#if deploySending}<span class="btn-loader" aria-hidden="true"></span>{/if}
							{deploySending ? 'Отправка...' : 'Обновить существующий навык'}
						</button>
						<button type="button" onclick={deployCreateNew} disabled={deploySending}
							>Создать копию</button
						>
						<button type="button" onclick={closeDeployModal} disabled={deploySending}>Отмена</button
						>
					</div>
				{/if}
			</div>
		</div>
	{/if}

	{#if showDeployAfterKeepLocal}
		<div
			class="modal-backdrop"
			role="dialog"
			aria-modal="true"
			aria-labelledby="deploy-after-keep-title"
		>
			<div class="modal">
				<h3 id="deploy-after-keep-title">Сохранить мои изменения</h3>
				<p class="small">
					Локальная версия оставлена. Не хотите ли сразу отправить её на сервер, чтобы избежать
					конфликтов в дальнейшем?
				</p>
				<div class="actions">
					<button
						type="button"
						class="primary"
						onclick={() => {
							closeDeployAfterKeepLocalModal();
							sendToGptzator();
						}}>Отправить в Ladcraft</button
					>
					<button type="button" onclick={closeDeployAfterKeepLocalModal}>Позже</button>
				</div>
			</div>
		</div>
	{/if}

	{#if widgetPreviewExpanded && widgetHtml}
		<div
			class="widget-fullscreen-backdrop"
			role="dialog"
			aria-modal="true"
			aria-label="Превью виджета на весь экран"
			bind:this={widgetFullscreenBackdropEl}
		>
			<iframe
				class="widget-fullscreen-frame"
				title="Превью виджета (полный экран)"
				srcdoc={widgetHtml}
				sandbox="allow-scripts allow-same-origin"
			></iframe>
			<div class="widget-fullscreen-close-bar">
				<button
					type="button"
					class="widget-fullscreen-close"
					title="Закрыть превью (Esc)"
					onclick={closeWidgetFullscreen}
					aria-label="Закрыть"
				>
					<svg
						xmlns="http://www.w3.org/2000/svg"
						width="28"
						height="28"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						stroke-width="2.5"
						stroke-linecap="round"
						stroke-linejoin="round"><path d="M18 6 6 18" /><path d="m6 6 12 12" /></svg
					>
				</button>
			</div>
		</div>
	{/if}

	{#if installEnvModalOpen}
		<div
			class="modal-backdrop"
			role="dialog"
			aria-modal="true"
			aria-labelledby="install-env-modal-title"
		>
			<div class="modal modal-wide install-env-modal">
				<h3 id="install-env-modal-title">Параметры установки навыка</h3>
				<p class="small">
					Укажите пользовательские переменные (environment.user из MCP spec) для установки в пространство
					Ladcraft.
				</p>
				<div class="install-env-fields">
					{#each installEnvMergedFields as field (`${field.key}`)}
						<div class="install-env-tool-group">
							<label class="install-env-row">
								<span class="install-env-label"
									>{field.title} <span class="muted">({field.format})</span></span
								>
								{#if field.format === 'boolean'}
									<select
										bind:value={installEnvValues[field.key]}
										onchange={scheduleInstallFormDraftPersist}
									>
										<option value="">—</option>
										<option value="true">true</option>
										<option value="false">false</option>
									</select>
								{:else}
									<input
										type={field.format === 'number'
											? 'number'
											: field.format === 'email'
												? 'email'
												: 'text'}
										bind:value={installEnvValues[field.key]}
										oninput={scheduleInstallFormDraftPersist}
									/>
								{/if}
							</label>
							<div class="small" style="margin-top: 4px;">
								Скрипты: {field.toolNames.join(', ')}
							</div>
						</div>
					{/each}
				</div>
				{#if installEnvError}
					<p class="small deploy-error" style="margin-top: 8px;">{installEnvError}</p>
				{/if}
				<div class="actions" style="margin-top: 12px;">
					<button type="button" class="primary" onclick={confirmInstallEnvModal}>Продолжить</button>
					<button type="button" onclick={cancelInstallEnvModal}>Отмена</button>
				</div>
			</div>
		</div>
	{/if}
</main>

<style>
	.validation-report {
		margin-top: 12px;
		border: 1px solid #d9e2ec;
		border-radius: 12px;
		padding: 12px;
		background: #fff;
	}

	.validation-report-error {
		border-color: #fecaca;
		background: #fff5f5;
	}

	.validation-report-warning {
		border-color: #fde68a;
		background: #fffbeb;
	}

	.validation-report-header {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 12px;
	}

	.validation-report-group {
		margin-top: 12px;
	}

	.validation-report-item {
		margin-top: 8px;
		padding: 8px;
		border: 1px solid #e5e7eb;
		border-radius: 10px;
		background: #fff;
	}

	.validation-report-meta {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 8px;
		margin-bottom: 4px;
		font-size: 12px;
	}

	.validation-report-badge {
		display: inline-flex;
		align-items: center;
		padding: 2px 8px;
		border-radius: 999px;
		background: #e5e7eb;
		font-weight: 600;
	}

	.validation-report-copy-btn {
		flex-shrink: 0;
	}

	.validation-report-details {
		margin-top: 10px;
		border: 1px solid #e5e7eb;
		border-radius: 10px;
		padding: 8px 10px;
		background: rgba(255, 255, 255, 0.65);
	}

	.validation-report-details-summary {
		cursor: pointer;
		font-size: 12px;
		font-weight: 600;
		color: #374151;
		list-style: none;
	}

	.validation-report-details-summary::-webkit-details-marker {
		display: none;
	}

	.validation-report-details-body {
		margin-top: 8px;
		padding-top: 8px;
		border-top: 1px solid #e5e7eb;
	}

	.validation-report-details-hint {
		margin: 0 0 8px;
		color: #4b5563;
	}

	.compatibility-icon-wrapper {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 16px;
		height: 16px;
		border-radius: 999px;
		background: #f59e0b;
		color: #fff;
		font-size: 11px;
		font-weight: 700;
		line-height: 1;
	}

	.compatibility-ok {
		margin-top: 12px;
		padding: 8px 10px;
		border: 1px solid #bbf7d0;
		border-radius: 10px;
		background: #f0fdf4;
		color: #166534;
	}

	.deploy-result-summary {
		font-size: 13px;
		margin-bottom: 8px;
	}

	.deploy-response-details {
		margin-top: 4px;
		border: 1px solid #e5e7eb;
		border-radius: 10px;
		padding: 8px 10px;
		background: #fafafa;
	}

	.deploy-response-details summary {
		cursor: pointer;
		font-size: 12px;
		font-weight: 600;
		color: #374151;
		list-style: none;
	}

	.deploy-response-details summary::-webkit-details-marker {
		display: none;
	}

	.deploy-response-pre {
		margin: 8px 0 0;
		max-height: 220px;
		overflow: auto;
		font-size: 11px;
		line-height: 1.35;
		white-space: pre-wrap;
		word-break: break-word;
	}
</style>
