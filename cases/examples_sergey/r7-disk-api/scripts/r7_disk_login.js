/**
 * Authenticate against R7-Disk API and return AuthToken.
 * @param {Record<string, unknown>} state
 * @param {{
 *   base_url?: unknown,
 *   login?: unknown,
 *   password?: unknown,
 *   credential_source?: unknown,
 *   web_url?: unknown,
 *   anchor_directory_id?: unknown
 * }} params
 */
async function handler(state, params) {
	const userEnv = readUserEnv(state);
	const skillStorage = resolveSkillStorage(state);
	const credentialSource = normalizeCredentialSource(params?.credential_source);
	const envConfigured = hasSavedCredentials(userEnv);

	if (!credentialSource && envConfigured) {
		return {
			ok: false,
			needs_credential_choice: true,
			environment_preview: {
				base_url: pickString('', userEnv.R7_DISK_BASE_URL).replace(/\/+$/, ''),
				login: maskLogin(pickString('', userEnv.R7_DISK_LOGIN))
			},
			error:
				'Сначала уточните у пользователя источник учётных данных, затем вызовите login с credential_source: ' +
				'"environment" (сохранённые переменные навыка) или "custom" (другой диск — base_url, login, password в параметрах).'
		};
	}

	let baseUrl = '';
	let login = '';
	let password = '';

	if (credentialSource === 'environment') {
		baseUrl = pickString('', userEnv.R7_DISK_BASE_URL).replace(/\/+$/, '');
		login = pickString('', userEnv.R7_DISK_LOGIN);
		password = pickString('', userEnv.R7_DISK_PASSWORD);
	} else if (credentialSource === 'custom') {
		baseUrl = typeof params?.base_url === 'string' ? params.base_url.trim().replace(/\/+$/, '') : '';
		login = typeof params?.login === 'string' ? params.login.trim() : '';
		password = typeof params?.password === 'string' ? params.password : '';
	} else {
		baseUrl = resolveBaseUrl(state, params, skillStorage);
		login = pickString(params?.login, userEnv.R7_DISK_LOGIN);
		password = pickString(params?.password, userEnv.R7_DISK_PASSWORD);
	}

	if (!baseUrl) {
		return {
			ok: false,
			error:
				credentialSource === 'custom'
					? 'Для credential_source=custom задайте base_url в параметрах вызова.'
					: 'Не задан R7_DISK_BASE_URL (environment.user или параметр base_url).'
		};
	}
	if (!login) {
		return {
			ok: false,
			error:
				credentialSource === 'custom'
					? 'Для credential_source=custom задайте login в параметрах вызова.'
					: 'Не задан R7_DISK_LOGIN.'
		};
	}
	if (!password) {
		return {
			ok: false,
			error:
				credentialSource === 'custom'
					? 'Для credential_source=custom задайте password в параметрах вызова.'
					: 'Не задан R7_DISK_PASSWORD.'
		};
	}

	const url = `${baseUrl}/api/v2/auth/Login`;
	let response;
	try {
		response = await fetch(url, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json; charset=utf-8' },
			body: JSON.stringify({ Login: login, Password: password })
		});
	} catch (err) {
		return {
			ok: false,
			error: `Сетевая ошибка при обращении к ${url}: ${errorMessage(err)}`
		};
	}

	const rawText = await readUtf8Text(response);
	let payload;
	try {
		payload = rawText ? JSON.parse(rawText) : {};
	} catch {
		return {
			ok: false,
			error: `Ответ login не JSON (HTTP ${response.status}): ${truncate(rawText, 300)}`
		};
	}

	if (!response.ok) {
		return {
			ok: false,
			error: `Login HTTP ${response.status}: ${truncate(rawText, 300)}`
		};
	}

	const tokens = payload?.Response?.Data?.Tokens;
	const authToken = typeof tokens?.AuthToken === 'string' ? tokens.AuthToken : '';
	if (!authToken) {
		return {
			ok: false,
			error: `AuthToken не найден в ответе: ${truncate(rawText, 300)}`
		};
	}

	const user = payload?.Response?.Data?.User ?? null;
	const modulesAccess = Array.isArray(payload?.Response?.Data?.ModulesAccess)
		? payload.Response.Data.ModulesAccess.filter((x) => typeof x === 'string')
		: [];
	const expiredAt = typeof tokens?.ExpiredAt === 'string' ? tokens.ExpiredAt : '';

	const userRecord = user && typeof user === 'object' ? user : {};
	const userDirectoryHints = extractUserDirectoryFieldHints(userRecord);
	const loginEmail =
		typeof userRecord.Email === 'string' && userRecord.Email.trim()
			? userRecord.Email.trim()
			: login;

	const webParsed = parseWebDiskUrl(params?.web_url);
	const anchorFromParam = parsePositiveId(params?.anchor_directory_id);
	const anchorDirectoryId =
		anchorFromParam ?? webParsed?.directory_id ?? null;

	const resolved = await resolvePersonalRoot({
		baseUrl,
		authToken,
		userRecord,
		anchorDirectoryId,
		userDirectoryHints
	});
	let myDocumentsDirectoryId = resolved.personalRootId;
	const myDocumentsProbe = resolved.probe;
	let accessibleRoots = resolved.accessibleRoots;

	if (skillStorage) {
		resetSkillStorageForUser(skillStorage, loginEmail);
		skillStorage.set('r7_disk_auth_token', authToken);
		skillStorage.set('r7_disk_base_url', baseUrl);
		if (expiredAt) skillStorage.set('r7_disk_expired_at', expiredAt);
	}

	const sectionRoots = buildSectionRoots(accessibleRoots, myDocumentsDirectoryId);
	let personalEntry = null;
	if (myDocumentsDirectoryId != null) {
		const fetched = await fetchDirectoryEntry(baseUrl, authToken, myDocumentsDirectoryId);
		personalEntry = fetched.entry;
	}
	const storageAssessment = assessStorageState(
		myDocumentsDirectoryId,
		accessibleRoots,
		personalEntry,
		userEnv
	);
	if (skillStorage) {
		persistRootsToStorage(skillStorage, {
			personalRootId: myDocumentsDirectoryId,
			accessibleRoots,
			sectionRoots,
			storageState: storageAssessment.storage_state,
			createTarget: storageAssessment.create_target
		});
	}

	const standardRootBlocked =
		myDocumentsDirectoryId == null &&
		(myDocumentsProbe.probe_status === 406 ||
			myDocumentsProbe.probe_status === 403 ||
			myDocumentsProbe.probe_status === 404);

	const rootDiscoverySummary = buildRootDiscoverySummary(
		accessibleRoots,
		myDocumentsProbe,
		userDirectoryHints
	);

	/** @type {string} */
	let myDocumentsNote;
	if (myDocumentsDirectoryId != null) {
		myDocumentsNote =
			`Корень: id=${myDocumentsDirectoryId}. ${myDocumentsProbe.probe_note} ${rootDiscoverySummary}`;
	} else if (standardRootBlocked) {
		myDocumentsNote =
			`Корень id=1 недоступен (HTTP ${myDocumentsProbe.probe_status}). ${rootDiscoverySummary} ` +
			'Укажите имя расшаренной папки (browse folder_name) или R7_DISK_DEFAULT_PARENT_DIRECTORY_ID у администратора.';
	} else {
		myDocumentsNote =
			`Корень не найден. ${rootDiscoverySummary} ` +
			'Если accessible_count=0 — администратор Р7 должен выдать личное хранилище или общую папку.';
	}

	const isEmpty =
		myDocumentsDirectoryId != null && isDirectoryEntryEmpty(personalEntry);

	return {
		...withFactualCitation(
		{
			ok: true,
			auth_token: authToken,
			expired_at: expiredAt,
			user: userRecord,
			modules_access: modulesAccess,
			...(myDocumentsDirectoryId != null
				? { my_documents_directory_id: myDocumentsDirectoryId }
				: {}),
			my_documents_accessible: myDocumentsDirectoryId != null,
			my_documents_probe_status: myDocumentsProbe.probe_status,
			my_documents_note: myDocumentsNote,
			root_discovery_summary: rootDiscoverySummary,
			standard_folders_warning: standardRootBlocked
				? `У пользователя ${login} нет доступа к стандартному корню диска (HTTP ${myDocumentsProbe.probe_status}). ` +
					'Работайте через disk_section=docs или folder_name в browse — не перебирайте id наугад.'
				: '',
			accessible_directory_roots: accessibleRoots,
			section_roots: sectionRoots,
			storage_state: storageAssessment.storage_state,
			is_empty: isEmpty,
			create_target: storageAssessment.create_target,
			...(myDocumentsDirectoryId != null
				? {
						folder_create_example: {
							operation: 'create',
							auth_token: authToken,
							parent_directory_id: myDocumentsDirectoryId,
							name: 'Имя_папки'
						},
						folder_batch_create_example: {
							operation: 'create',
							auth_token: authToken,
							parent_directory_id: myDocumentsDirectoryId,
							names: ['Папка1', 'Папка2', 'Папка3']
						},
						browse_all_files_example: {
							tool: 'r7_disk_browse',
							my_documents_directory_id: myDocumentsDirectoryId,
							directory_id: myDocumentsDirectoryId
						},
						list_root_example: {
							tool: 'r7_disk_list_directory',
							my_documents_directory_id: myDocumentsDirectoryId,
							directory_id: myDocumentsDirectoryId
						}
					}
				: {}),
			...(webParsed ? { web_url_parsed: webParsed } : {}),
			user_directory_field_hints: userDirectoryHints,
			...(myDocumentsDirectoryId == null
				? {
						root_not_found: true,
						do_not_guess_directory_ids: true,
						forbid_directory_id_probe: true,
						ask_user_for: ['folder_name', 'web_url', 'anchor_subdirectory_url'],
						next_steps: [
							'Спросите имя папки (не числовой id корня) или URL вида /docs/52',
							'r7_disk_browse с folder_name',
							'r7_disk_login с anchor_directory_id подпапки',
							'r7_disk_set_my_documents_directory_id после нахождения корня'
						]
					}
				: {}),
			agent_message: buildLoginAgentMessage(
				userRecord,
				modulesAccess,
				myDocumentsDirectoryId,
				standardRootBlocked,
				login,
				accessibleRoots,
				storageAssessment
			),
			api_base_url: baseUrl,
			credential_source: credentialSource || 'params_or_env'
		},
		[
			'my_documents_directory_id',
			'accessible_directory_roots',
			'create_target',
			'storage_state',
			'agent_message'
		]
	),
		do_not_retry: true,
		forbid_followup_tools: ['r7_disk_login'],
		session_note:
			'Вход выполнен. **Не** вызывайте r7_disk_login повторно в этой сессии — используйте auth_token из ответа или кэш skillStorage.'
	};
}

/**
 * @param {Record<string, unknown>} user
 * @param {string[]} modulesAccess
 * @param {number | null} myDocumentsDirectoryId
 * @param {boolean} standardRootBlocked
 * @param {string} login
 */
/**
 * @param {Record<string, unknown>} user
 * @returns {Array<{ field: string, value: unknown }>}
 */
function extractUserDirectoryFieldHints(user) {
	/** @type {Array<{ field: string, value: unknown }>} */
	const hints = [];
	for (const [key, value] of Object.entries(user)) {
		if (!/directory|folder|document|root|storage/i.test(key)) continue;
		if (
			typeof value === 'number' ||
			typeof value === 'string' ||
			(value && typeof value === 'object')
		) {
			hints.push({ field: key, value });
		}
	}
	return hints;
}

/** @typedef {'docs'|'shared_to_me'|'shared_access'|'favorites'|'common'|'recycle_bin'|'recent'|'file_depot'} DiskSection */

/** @typedef {'personal_empty'|'personal_with_content'|'no_personal_only_shared'|'no_accessible_roots'} StorageState */

const STANDARD_PROBE_IDS = [1, 0];
const DEFAULT_SCAN_MAX_ID = 512;
const COMMON_ROOT_NAME_RE =
	/^(общ|common|shared|корзин|избран|ладкрафт|recycle|favorites?|recent|file\s*depot)/i;

const WEB_SECTION_PATHS = {
	docs: 'docs',
	'shared-to-me': 'shared_to_me',
	shared_to_me: 'shared_to_me',
	'shared-access': 'shared_access',
	shared_access: 'shared_access',
	favorites: 'favorites',
	common: 'common',
	'recycle-bin': 'recycle_bin',
	recycle_bin: 'recycle_bin',
	recent: 'recent',
	filedepot: 'file_depot',
	file_depot: 'file_depot'
};

/**
 * @param {unknown} url
 * @returns {{ section: DiskSection, directory_id: number | null, web_path: string } | null}
 */
function parseWebDiskUrl(url) {
	if (typeof url !== 'string' || !url.trim()) return null;
	const trimmed = url.trim();
	const pathname = extractUrlPathname(trimmed);
	if (!pathname) return null;
	const match = pathname.match(
		/^\/(docs|shared-to-me|shared-access|favorites|common|recycle-bin|recent|fileDepot|filedepot)(?:\/(\d+))?\/?$/i
	);
	if (!match) return null;
	const rawSection = match[1].toLowerCase();
	const sectionKey =
		rawSection === 'filedepot'
			? 'file_depot'
			: /** @type {keyof typeof WEB_SECTION_PATHS} */ (rawSection.replace(/-/g, '_'));
	const section = WEB_SECTION_PATHS[sectionKey] ?? WEB_SECTION_PATHS[rawSection];
	if (!section) return null;
	const idPart = match[2];
	const directoryId =
		idPart && Number.isFinite(Number(idPart)) && Number(idPart) > 0
			? Math.trunc(Number(idPart))
			: null;
	return {
		section: /** @type {DiskSection} */ (section),
		directory_id: directoryId,
		web_path: `/${match[1]}${directoryId != null ? `/${directoryId}` : ''}`
	};
}

/**
 * Путь из полного URL или относительного `/docs/...` (без URL.pathname — ограничение runtime).
 * @param {string} url
 * @returns {string}
 */
function extractUrlPathname(url) {
	const trimmed = url.trim();
	const fromFull = trimmed.match(/^https?:\/\/[^/?#]+(\/[^?#]*)?/i);
	if (fromFull) return fromFull[1] || '/';
	if (trimmed.startsWith('/')) {
		const noQuery = trimmed.split('?')[0].split('#')[0];
		return noQuery || '/';
	}
	return trimmed;
}

function isCommonOrSharedRootName(name) {
	return COMMON_ROOT_NAME_RE.test(name.trim());
}

const SCAN_BATCH_SIZE = 12;

/**
 * Приоритет 2–128 (типичный личный корень не-админа), затем 129–512.
 * @param {number} [maxId]
 * @returns {number[]}
 */
function buildPrioritizedScanIds(maxId = DEFAULT_SCAN_MAX_ID) {
	const limit = Math.max(32, Math.min(maxId, DEFAULT_SCAN_MAX_ID));
	/** @type {number[]} */
	const ids = [];
	for (let i = 2; i <= Math.min(128, limit); i++) ids.push(i);
	for (let i = 129; i <= Math.min(256, limit); i++) ids.push(i);
	for (let i = 257; i <= limit; i++) ids.push(i);
	return ids;
}

/**
 * @param {number[]} ids
 * @param {number} size
 * @returns {number[][]}
 */
function chunkIds(ids, size) {
	/** @type {number[][]} */
	const out = [];
	for (let i = 0; i < ids.length; i += size) {
		out.push(ids.slice(i, i + size));
	}
	return out;
}

/**
 * @param {string} baseUrl
 * @param {string} authToken
 * @param {number[]} ids
 */
async function fetchDirectoryEntriesBatch(baseUrl, authToken, ids) {
	const results = await Promise.all(
		ids.map((id) => fetchDirectoryEntry(baseUrl, authToken, id))
	);
	return ids.map((id, index) => ({ id, ...results[index] }));
}

/**
 * @param {Record<string, unknown>} entry
 * @param {number} candidateId
 * @returns {{ id: number, name: string, parent_id: number | null, is_top_level: boolean } | null}
 */
function rootMetaFromEntry(entry, candidateId) {
	const entryId = typeof entry.Id === 'number' ? entry.Id : candidateId;
	const name = typeof entry.Name === 'string' ? entry.Name.trim() : `id=${entryId}`;
	const parentId = readParentDirectoryId(entry);
	return {
		id: entryId,
		name,
		parent_id: parentId,
		is_top_level: parentId == null || parentId === 0
	};
}

/**
 * Быстрый поиск личного корня (параллельные батчи, ранний выход).
 * @param {string} baseUrl
 * @param {string} authToken
 */
async function discoverPersonalRootFast(baseUrl, authToken) {
	/** @type {Record<string, number | null>} */
	const probeStatusById = {};
	let lastStatus = null;
	/** @type {{ id: number, name: string } | null} */
	let fallback = null;

	for (const batch of chunkIds(buildPrioritizedScanIds(), SCAN_BATCH_SIZE)) {
		const fetched = await fetchDirectoryEntriesBatch(baseUrl, authToken, batch);
		for (const item of fetched) {
			probeStatusById[String(item.id)] = item.status;
			if (item.status != null) lastStatus = item.status;
			if (!item.entry) continue;
			const entry = item.entry;
			const name = typeof entry.Name === 'string' ? entry.Name : '';
			const entryId = typeof entry.Id === 'number' ? entry.Id : item.id;
			if (/мои\s*документ|my\s*documents/i.test(name.trim())) {
				return {
					directory_id: entryId,
					probe_status: item.status,
					probe_note: `Быстрый поиск: «${name.trim()}» (id=${entryId}).`,
					probe_status_by_id: probeStatusById
				};
			}
			if (fallback == null && looksLikeMyDocumentsRoot(entry, name)) {
				fallback = { id: entryId, name: name.trim() || `id=${entryId}` };
			}
		}
	}

	if (fallback != null) {
		return {
			directory_id: fallback.id,
			probe_status: lastStatus,
			probe_note: `Быстрый поиск: «${fallback.name}» (id=${fallback.id}).`,
			probe_status_by_id: probeStatusById
		};
	}
	return null;
}

async function scanAccessibleDirectoryRoots(baseUrl, authToken, maxId = DEFAULT_SCAN_MAX_ID) {
	/** @type {Array<{ id: number, name: string, parent_id: number | null, is_top_level: boolean }>} */
	const roots = [];
	/** @type {Record<string, number | null>} */
	const probeStatusById = {};

	for (const batch of chunkIds(buildPrioritizedScanIds(maxId), SCAN_BATCH_SIZE)) {
		const fetched = await fetchDirectoryEntriesBatch(baseUrl, authToken, batch);
		for (const item of fetched) {
			probeStatusById[String(item.id)] = item.status;
			if (!item.entry) continue;
			const meta = rootMetaFromEntry(item.entry, item.id);
			if (meta) roots.push(meta);
		}
	}

	return { roots, probe_status_by_id: probeStatusById };
}

async function climbToPersonalRoot(baseUrl, authToken, startId) {
	/** @type {Array<{ id: number, name: string }>} */
	const chain = [];
	let currentId = startId;
	const visited = new Set();

	while (currentId > 0 && !visited.has(currentId)) {
		visited.add(currentId);
		const fetched = await fetchDirectoryEntry(baseUrl, authToken, currentId);
		if (!fetched.entry) break;
		const entry = fetched.entry;
		const entryId = typeof entry.Id === 'number' ? entry.Id : currentId;
		const name = typeof entry.Name === 'string' ? entry.Name.trim() : `id=${entryId}`;
		chain.push({ id: entryId, name });
		if (looksLikeMyDocumentsRoot(entry, name)) {
			return { personal_root_id: entryId, chain };
		}
		const parentId = readParentDirectoryId(entry);
		if (parentId == null || parentId === 0) break;
		currentId = parentId;
	}

	const myDocsInChain = [...chain]
		.reverse()
		.find((c) => /мои\s*документ|my\s*documents/i.test(c.name));
	if (myDocsInChain) {
		return { personal_root_id: myDocsInChain.id, chain };
	}
	return { personal_root_id: null, chain };
}

/**
 * @param {Array<{ id: number, name: string }>} roots
 * @param {{ probe_status: number | null, probe_note: string }} probe
 * @param {Array<{ field: string, value: unknown }>} hints
 * @returns {string}
 */
function buildRootDiscoverySummary(roots, probe, hints) {
	const parts = [
		`accessible_count=${roots.length}`,
		`probed_ids_up_to=${DEFAULT_SCAN_MAX_ID}`,
		probe.probe_status != null ? `last_probe_status=${probe.probe_status}` : '',
		hints.length > 0 ? `user_hints=${hints.map((h) => h.field).join(',')}` : 'user_hints=none'
	];
	if (roots.length > 0) {
		parts.push(
			`roots=${roots
				.slice(0, 8)
				.map((r) => `${r.name}:${r.id}`)
				.join('; ')}`
		);
	}
	return parts.filter(Boolean).join(' | ');
}

/**
 * @param {Record<string, unknown>} entry
 * @returns {number | null}
 */
function readParentDirectoryId(entry) {
	const parentRaw =
		entry.Parent && typeof entry.Parent === 'object' ? entry.Parent : null;
	const parent = parentRaw ? /** @type {Record<string, unknown>} */ (parentRaw) : null;
	if (parent && typeof parent.Id === 'number') return parent.Id;
	if (typeof entry.ParentId === 'number') return entry.ParentId;
	return null;
}

/**
 * @param {Array<{ id: number, name: string, parent_id: number | null, is_top_level: boolean }>} roots
 * @returns {{ id: number, name: string } | null}
 */
function pickPersonalRootDirectory(roots) {
	if (roots.length === 0) return null;
	const personalOnly = roots.filter((r) => !isCommonOrSharedRootName(r.name));
	const byMyDocsName = personalOnly.find((r) =>
		/мои\s*документ|my\s*documents|личн|personal/i.test(r.name)
	);
	if (byMyDocsName) return { id: byMyDocsName.id, name: byMyDocsName.name };
	const topLevel = personalOnly.filter((r) => r.is_top_level);
	if (topLevel.length === 1) {
		return { id: topLevel[0].id, name: topLevel[0].name };
	}
	return null;
}

function pickSharedCreateTarget(roots) {
	const shared = roots.filter(
		(r) =>
			!isCommonOrSharedRootName(r.name) &&
			!/мои\s*документ|my\s*documents/i.test(r.name)
	);
	if (shared.length === 1) return { id: shared[0].id, name: shared[0].name };
	const named = shared.find((r) => /ладкрафт|работа|проект/i.test(r.name));
	if (named) return { id: named.id, name: named.name };
	return shared.length > 0 ? { id: shared[0].id, name: shared[0].name } : null;
}

function buildSectionRoots(roots, personalRootId) {
	/** @type {Record<string, number | null>} */
	const sectionRoots = {
		docs: personalRootId,
		shared_to_me: null,
		shared_access: null,
		favorites: null,
		common: null,
		recycle_bin: null,
		recent: null,
		file_depot: null
	};
	for (const root of roots) {
		const n = root.name.toLowerCase();
		if (/^общ|common/.test(n)) sectionRoots.common = root.id;
		else if (/доступно|shared.?to.?me|мне/.test(n)) sectionRoots.shared_to_me = root.id;
		else if (/совместн|shared.?access/.test(n)) sectionRoots.shared_access = root.id;
		else if (/избран|favorites?/.test(n)) sectionRoots.favorites = root.id;
		else if (/корзин|recycle/.test(n)) sectionRoots.recycle_bin = root.id;
		else if (/последн|recent/.test(n)) sectionRoots.recent = root.id;
		else if (/хранилищ|file.?depot|depot/.test(n)) sectionRoots.file_depot = root.id;
	}
	return sectionRoots;
}

function isDirectoryEntryEmpty(entry) {
	if (!entry) return true;
	const folders = Array.isArray(entry.Children) ? entry.Children : [];
	const documents = Array.isArray(entry.Documents) ? entry.Documents : [];
	return folders.length === 0 && documents.length === 0;
}

function assessStorageState(personalRootId, accessibleRoots, personalEntry = null, userEnv = {}) {
	const defaultParent = parsePositiveId(userEnv.R7_DISK_DEFAULT_PARENT_DIRECTORY_ID);

	if (personalRootId != null) {
		const empty = isDirectoryEntryEmpty(personalEntry);
		const rootName =
			personalEntry && typeof personalEntry.Name === 'string'
				? personalEntry.Name
				: 'Мои документы';
		return {
			storage_state: /** @type {StorageState} */ (empty ? 'personal_empty' : 'personal_with_content'),
			create_target: {
				parent_directory_id: personalRootId,
				parent_name: rootName,
				disk_section: 'docs',
				can_create_here: true,
				create_hint: empty
					? `Личное хранилище «${rootName}» (id=${personalRootId}) пусто. Создайте папку: r7_disk_folder с operation=create, auth_token из login, parent_directory_id=${personalRootId}, name (или names для нескольких).`
					: `Создание в «${rootName}» (id=${personalRootId}): r7_disk_folder с auth_token и parent_directory_id=${personalRootId}.`
			}
		};
	}

	const sharedTarget = pickSharedCreateTarget(accessibleRoots);
	if (sharedTarget != null || defaultParent != null) {
		const parentId = defaultParent ?? sharedTarget?.id ?? null;
		const parentName = sharedTarget?.name ?? `id=${parentId}`;
		return {
			storage_state: /** @type {StorageState} */ ('no_personal_only_shared'),
			create_target:
				parentId != null
					? {
							parent_directory_id: parentId,
							parent_name: parentName,
							disk_section: 'shared_to_me',
							can_create_here: true,
							create_hint: `Личного «Мои документы» нет. Создание возможно в «${parentName}» (id=${parentId}).`
						}
					: null
		};
	}

	return {
		storage_state: /** @type {StorageState} */ ('no_accessible_roots'),
		create_target: null
	};
}

function resetSkillStorageForUser(skillStorage, loginEmail) {
	if (!skillStorage) return;
	const prev = skillStorage.get('r7_disk_login_email');
	if (typeof prev === 'string' && prev && prev !== loginEmail) {
		for (const key of [
			'r7_disk_my_documents_directory_id',
			'r7_disk_accessible_roots',
			'r7_disk_section_roots',
			'r7_disk_storage_state',
			'r7_disk_create_target'
		]) {
			skillStorage.set(key, '');
		}
	}
	skillStorage.set('r7_disk_login_email', loginEmail);
}

function persistRootsToStorage(skillStorage, data) {
	if (!skillStorage) return;
	if (data.personalRootId != null) {
		skillStorage.set('r7_disk_my_documents_directory_id', String(data.personalRootId));
	}
	if (data.accessibleRoots.length > 0) {
		skillStorage.set('r7_disk_accessible_roots', JSON.stringify(data.accessibleRoots));
	}
	skillStorage.set('r7_disk_section_roots', JSON.stringify(data.sectionRoots));
	skillStorage.set('r7_disk_storage_state', data.storageState);
	if (data.createTarget) {
		skillStorage.set('r7_disk_create_target', JSON.stringify(data.createTarget));
	}
}

async function resolvePersonalRoot(options) {
	const {
		baseUrl,
		authToken,
		userRecord = {},
		anchorDirectoryId = null,
		userDirectoryHints = []
	} = options;

	let personalRootId = extractDirectoryIdFromUser(userRecord);
	/** @type {{ ok: boolean, directory_id: number | null, probe_status: number | null, probe_note: string }} */
	let probe = { ok: false, directory_id: null, probe_status: null, probe_note: '' };
	/** @type {Array<{ id: number, name: string, parent_id: number | null, is_top_level: boolean }>} */
	let accessibleRoots = [];

	if (personalRootId == null) {
		probe = await discoverStandardMyDocumentsProbe(baseUrl, authToken);
		personalRootId = probe.directory_id;
	} else {
		probe = {
			ok: true,
			directory_id: personalRootId,
			probe_status: 200,
			probe_note: 'ID из профиля User после Login.'
		};
	}

	if (personalRootId == null && anchorDirectoryId != null) {
		const climbed = await climbToPersonalRoot(baseUrl, authToken, anchorDirectoryId);
		if (climbed.personal_root_id != null) {
			personalRootId = climbed.personal_root_id;
			probe = {
				ok: true,
				directory_id: personalRootId,
				probe_status: 200,
				probe_note: `Корень найден по цепочке Parent от id=${anchorDirectoryId}.`
			};
		}
	}

	if (personalRootId == null) {
		for (const hint of userDirectoryHints) {
			const candidates = [];
			if (typeof hint.value === 'number' && hint.value > 0) candidates.push(hint.value);
			if (hint.value && typeof hint.value === 'object') {
				const record = /** @type {Record<string, unknown>} */ (hint.value);
				for (const key of ['Id', 'id', 'DirectoryId', 'directory_id']) {
					const v = record[key];
					if (typeof v === 'number' && v > 0) candidates.push(v);
				}
			}
			for (const id of candidates) {
				const fetched = await fetchDirectoryEntry(baseUrl, authToken, id);
				if (fetched.entry) {
					const name =
						typeof fetched.entry.Name === 'string' ? fetched.entry.Name : `id=${id}`;
					if (looksLikeMyDocumentsRoot(fetched.entry, name)) {
						personalRootId = id;
						probe = {
							ok: true,
							directory_id: id,
							probe_status: 200,
							probe_note: `Корень из User.${hint.field}: «${name}» (id=${id}).`
						};
						break;
					}
				}
			}
			if (personalRootId != null) break;
		}
	}

	if (personalRootId == null) {
		const fast = await discoverPersonalRootFast(baseUrl, authToken);
		if (fast != null) {
			personalRootId = fast.directory_id;
			probe = {
				ok: true,
				directory_id: fast.directory_id,
				probe_status: fast.probe_status,
				probe_note: fast.probe_note
			};
		}
	}

	if (personalRootId == null) {
		const scanResult = await scanAccessibleDirectoryRoots(baseUrl, authToken);
		accessibleRoots = scanResult.roots;
		const picked = pickPersonalRootDirectory(accessibleRoots);
		if (picked != null) {
			personalRootId = picked.id;
			probe = {
				ok: true,
				directory_id: picked.id,
				probe_status: 200,
				probe_note: `Корень найден сканированием: «${picked.name}» (id=${picked.id}).`
			};
		} else if (scanResult.probe_status_by_id['1'] === 406) {
			probe.probe_status = 406;
		}
	} else if (accessibleRoots.length === 0) {
		const scanResult = await scanAccessibleDirectoryRoots(baseUrl, authToken);
		accessibleRoots = scanResult.roots;
	}

	return { personalRootId, probe, accessibleRoots };
}

function buildLoginAgentMessage(
	user,
	modulesAccess,
	myDocumentsDirectoryId,
	standardRootBlocked,
	login,
	accessibleRoots,
	storageAssessment
) {
	const displayName =
		typeof user.DisplayName === 'string'
			? user.DisplayName
			: typeof user.Name === 'string'
				? user.Name
				: login;
	const email = typeof user.Email === 'string' ? user.Email : '';
	const hasDisk = modulesAccess.some((m) => String(m).toLowerCase() === 'disk');
	let msg = `Вход выполнен: ${displayName}`;
	if (email) msg += ` (${email})`;
	if (!hasDisk) {
		msg += '. Модуль Disk не в modules_access — обратитесь к администратору Р7.';
		return msg;
	}
	if (myDocumentsDirectoryId != null) {
		const rootMeta = accessibleRoots.find((r) => r.id === myDocumentsDirectoryId);
		const rootName = rootMeta?.name ?? `id=${myDocumentsDirectoryId}`;
		msg += `. Ваш корень «Мои документы»: «${rootName}» (id=${myDocumentsDirectoryId}). `;
		if (storageAssessment.storage_state === 'personal_empty') {
			msg +=
				'Хранилище пустое — создайте папку через folder_create_example из ответа login (auth_token + parent_directory_id + name).';
		} else {
			msg +=
				`Список всех файлов (включая подпапки): r7_disk_browse с my_documents_directory_id=${myDocumentsDirectoryId}. ` +
				'Не используйте только list_directory корня — он не показывает файлы внутри подпапок.';
		}
	} else if (storageAssessment.storage_state === 'no_personal_only_shared') {
		const target = storageAssessment.create_target;
		if (target && typeof target.parent_directory_id === 'number') {
			msg += `. Личного корня нет; для создания используйте «${target.parent_name}» (id=${target.parent_directory_id}).`;
		} else {
			const names = accessibleRoots
				.slice(0, 5)
				.map((r) => `«${r.name}» id=${r.id}`)
				.join(', ');
			msg += `. Стандартный id=1 недоступен; доступны: ${names}.`;
		}
	} else if (accessibleRoots.length > 0) {
		const names = accessibleRoots
			.slice(0, 5)
			.map((r) => `«${r.name}» id=${r.id}`)
			.join(', ');
		msg += `. Корень не определён; найдены каталоги: ${names}. Используйте disk_section или folder_name.`;
	} else if (standardRootBlocked) {
		msg +=
			'. Корень «Мои документы» (id=1) недоступен и других каталогов по API не найдено. ' +
			'Спросите у пользователя **имя папки** или URL `/docs/N` (не перебирайте id 1–4).';
	} else {
		msg +=
			'. Корень не найден автоматически. **Сразу** спросите имя папки или URL `/docs/N` ' +
			'(например «Привет», «Ладкрафт»). Либо login с `anchor_directory_id` известной подпапки. ' +
			'**Запрещено** перебирать directory_id 0–10 «наугад». api/2.0/crm/files/root — CRM, не Диск КС 2024.';
	}
	return msg;
}

/**
 * @param {Record<string, unknown>} user
 * @returns {number | null}
 */
function extractDirectoryIdFromUser(user) {
	const keys = [
		'DocumentsDirectoryId',
		'DocumentDirectoryId',
		'DirectoryId',
		'RootDirectoryId',
		'PersonalDirectoryId',
		'MyDocumentsDirectoryId'
	];
	for (const key of keys) {
		const value = user[key];
		if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
			return value;
		}
	}
	return null;
}

async function discoverStandardMyDocumentsProbe(baseUrl, authToken) {
	let lastStatus = null;
	for (const candidateId of STANDARD_PROBE_IDS) {
		const fetched = await fetchDirectoryEntry(baseUrl, authToken, candidateId);
		lastStatus = fetched.status;
		if (!fetched.entry) continue;
		const entry = fetched.entry;
		const entryId = typeof entry.Id === 'number' ? entry.Id : candidateId;
		const name = typeof entry.Name === 'string' ? entry.Name : '';
		if (looksLikeMyDocumentsRoot(entry, name)) {
			return {
				ok: true,
				directory_id: entryId,
				probe_status: fetched.status,
				probe_note: `Стандартный корень: id=${entryId}, «${name}».`
			};
		}
	}
	return {
		ok: false,
		directory_id: null,
		probe_status: lastStatus,
		probe_note:
			lastStatus === 406 || lastStatus === 403
				? 'Стандартный корень (id=1/0) недоступен.'
				: 'Стандартный корень не найден.'
	};
}

/**
 * @param {unknown} value
 * @returns {number | null}
 */
function parsePositiveId(value) {
	if (typeof value === 'number' && Number.isFinite(value) && value > 0) return Math.trunc(value);
	if (typeof value === 'string' && value.trim()) {
		const parsed = Number(value.trim());
		if (Number.isFinite(parsed) && parsed > 0) return Math.trunc(parsed);
	}
	return null;
}

/**
 * @param {Record<string, unknown>} entry
 * @param {string} name
 * @returns {boolean}
 */
function looksLikeMyDocumentsRoot(entry, name) {
	const parentId = readParentDirectoryId(entry);
	if (parentId == null || parentId === 0) {
		return !isCommonOrSharedRootName(name);
	}
	return /мои\s*документ|my\s*documents|^documents$/i.test(name.trim());
}

/**
 * @param {string} baseUrl
 * @param {string} authToken
 * @param {number} directoryId
 * @returns {Promise<{ entry: Record<string, unknown> | null, status: number | null }>}
 */
async function fetchDirectoryEntry(baseUrl, authToken, directoryId) {
	const url = `${baseUrl}/api/v1/DocumentDirectory/Get?id=${encodeURIComponent(String(directoryId))}`;
	let response;
	try {
		response = await fetch(url, {
			method: 'GET',
			headers: { 'Content-Type': 'application/json', Authorization: authToken }
		});
	} catch {
		return { entry: null, status: null };
	}
	const status = response.status;
	if (!response.ok) return { entry: null, status };
	const rawText = await readUtf8Text(response);
	try {
		const payload = rawText ? JSON.parse(rawText) : [];
		const entries = Array.isArray(payload) ? payload : [payload];
		const entry = entries.find((item) => item && typeof item === 'object');
		return {
			entry:
				entry && typeof entry === 'object'
					? /** @type {Record<string, unknown>} */ (entry)
					: null,
			status
		};
	} catch {
		return { entry: null, status };
	}
}

/**
 * @param {Record<string, unknown>} userEnv
 * @returns {boolean}
 */
function hasSavedCredentials(userEnv) {
	return Boolean(
		pickString('', userEnv.R7_DISK_BASE_URL) &&
			pickString('', userEnv.R7_DISK_LOGIN) &&
			pickString('', userEnv.R7_DISK_PASSWORD)
	);
}

/**
 * @param {unknown} value
 * @returns {'environment' | 'custom' | ''}
 */
function normalizeCredentialSource(value) {
	if (typeof value !== 'string') return '';
	const normalized = value.trim().toLowerCase();
	if (normalized === 'environment' || normalized === 'saved' || normalized === 'env') {
		return 'environment';
	}
	if (normalized === 'custom' || normalized === 'other' || normalized === 'manual') {
		return 'custom';
	}
	return '';
}

/**
 * @param {string} login
 * @returns {string}
 */
function maskLogin(login) {
	if (!login) return '';
	if (login.length <= 2) return '**';
	return `${login.slice(0, 2)}***`;
}

/**
 * @typedef {Object} SkillKeyValueStorage
 * @property {(key: string) => unknown} get
 * @property {(key: string, value: string) => void} set
 */

/**
 * @param {Record<string, unknown>} state
 * @returns {SkillKeyValueStorage | null}
 */
function resolveSkillStorage(state) {
	const caps = state.capabilities;
	if (!caps || typeof caps !== 'object') return null;
	const record = /** @type {Record<string, unknown>} */ (caps);
	const raw = record.skillStorage ?? record.storage ?? record['key-value-storage'];
	if (!raw || typeof raw !== 'object') return null;
	const kv = /** @type {{ get?: unknown; set?: unknown }} */ (raw);
	if (typeof kv.get !== 'function' || typeof kv.set !== 'function') return null;
	return /** @type {SkillKeyValueStorage} */ (raw);
}

/**
 * @param {Record<string, unknown>} state
 * @returns {Record<string, unknown>}
 */
function readUserEnv(state) {
	const env = state.environment;
	if (!env || typeof env !== 'object') return {};
	const user = /** @type {Record<string, unknown>} */ (env).user;
	if (!user || typeof user !== 'object') return {};
	return /** @type {Record<string, unknown>} */ (user);
}

/**
 * Порядок: параметр вызова → кэш после успешного login → переменная установки навыка.
 * @param {Record<string, unknown>} state
 * @param {{ base_url?: unknown }} params
 * @param {SkillKeyValueStorage | null} skillStorage
 * @returns {string}
 */
function resolveBaseUrl(state, params, skillStorage) {
	const userEnv = readUserEnv(state);
	const fromParam = typeof params?.base_url === 'string' ? params.base_url.trim() : '';
	if (fromParam) return fromParam.replace(/\/+$/, '');
	if (skillStorage) {
		const cached = skillStorage.get('r7_disk_base_url');
		if (typeof cached === 'string' && cached.trim()) {
			return cached.trim().replace(/\/+$/, '');
		}
	}
	return pickString('', userEnv.R7_DISK_BASE_URL).replace(/\/+$/, '');
}

/**
 * @param {unknown} primary
 * @param {unknown} fallback
 * @returns {string}
 */
function pickString(primary, fallback) {
	if (typeof primary === 'string' && primary.trim()) return primary.trim();
	if (typeof fallback === 'string' && fallback.trim()) return fallback.trim();
	return '';
}

/**
 * @param {{ text: () => Promise<string> }} response
 * @returns {Promise<string>}
 */
async function readUtf8Text(response) {
	return response.text();
}

/**
 * @param {unknown} value
 * @returns {string}
 */
function errorMessage(value) {
	return value instanceof Error ? value.message : String(value);
}

/**
 * @param {string} text
 * @param {number} max
 * @returns {string}
 */
function truncate(text, max) {
	if (text.length <= max) return text;
	return `${text.slice(0, max)}…`;
}

/**
 * Подсказка агенту: не выдумывать данные вне полей ответа tool.
 * @template T
 * @param {T} fields
 * @param {string[]} citeOnlyFields
 * @returns {T}
 */
function withFactualCitation(fields, citeOnlyFields) {
	const record = /** @type {Record<string, unknown>} */ (/** @type {unknown} */ (fields));
	const msg = typeof record.agent_message === 'string' ? record.agent_message : '';
	const hint = ` Цитируй только ${citeOnlyFields.join(', ')} — не выдумывай.`;
	return /** @type {T} */ ({
		...fields,
		do_not_invent_content: true,
		cite_only_fields: citeOnlyFields,
		agent_message: msg.includes('не выдумывай') ? msg : msg + hint
	});
}