/**
 * Shared R7-Disk directory root discovery (inlined into login/list/browse/folder).
 * Standalone reference module; Ladcraft scripts do not import across files.
 */

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
	let pathname = trimmed;
	const fromFull = trimmed.match(/^https?:\/\/[^/?#]+(\/[^?#]*)?/i);
	if (fromFull) {
		pathname = fromFull[1] || '/';
	} else if (trimmed.startsWith('/')) {
		pathname = trimmed.split('?')[0].split('#')[0] || '/';
	}
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
 * @param {unknown} value
 * @returns {DiskSection | null}
 */
function normalizeDiskSection(value) {
	if (typeof value !== 'string' || !value.trim()) return null;
	const key = value.trim().toLowerCase().replace(/-/g, '_');
	const mapped = WEB_SECTION_PATHS[key];
	return mapped ? /** @type {DiskSection} */ (mapped) : null;
}

/**
 * @param {string} name
 * @returns {boolean}
 */
function isCommonOrSharedRootName(name) {
	return COMMON_ROOT_NAME_RE.test(name.trim());
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
 * @param {{ text: () => Promise<string> }} response
 * @returns {Promise<string>}
 */
async function readUtf8Text(response) {
	return response.text();
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
 * @param {number} maxId
 * @returns {number[]}
 */
function buildScanIdRange(maxId) {
	const limit = Math.max(32, Math.min(maxId, DEFAULT_SCAN_MAX_ID));
	/** @type {number[]} */
	const ids = [];
	for (let i = 0; i <= limit; i++) ids.push(i);
	return ids;
}

/**
 * @param {string} baseUrl
 * @param {string} authToken
 * @param {number} [maxId]
 * @returns {Promise<{
 *   roots: Array<{ id: number, name: string, parent_id: number | null, is_top_level: boolean }>,
 *   probe_status_by_id: Record<string, number | null>
 * }>}
 */
async function scanAccessibleDirectoryRoots(baseUrl, authToken, maxId = DEFAULT_SCAN_MAX_ID) {
	/** @type {Array<{ id: number, name: string, parent_id: number | null, is_top_level: boolean }>} */
	const roots = [];
	/** @type {Record<string, number | null>} */
	const probeStatusById = {};
	let consecutiveMiss = 0;
	let lastHit = -1;

	for (const candidateId of buildScanIdRange(maxId)) {
		const fetched = await fetchDirectoryEntry(baseUrl, authToken, candidateId);
		probeStatusById[String(candidateId)] = fetched.status;
		if (!fetched.entry) {
			if (lastHit >= 0 && candidateId > lastHit + 32) {
				consecutiveMiss++;
				if (consecutiveMiss >= 50) break;
			}
			continue;
		}
		consecutiveMiss = 0;
		lastHit = candidateId;
		const entry = fetched.entry;
		const entryId = typeof entry.Id === 'number' ? entry.Id : candidateId;
		const name = typeof entry.Name === 'string' ? entry.Name.trim() : `id=${entryId}`;
		const parentId = readParentDirectoryId(entry);
		const isTopLevel = parentId == null || parentId === 0;
		roots.push({ id: entryId, name, parent_id: parentId, is_top_level: isTopLevel });
	}
	return { roots, probe_status_by_id: probeStatusById };
}

/**
 * @param {string} baseUrl
 * @param {string} authToken
 * @param {number} startId
 * @returns {Promise<{ personal_root_id: number | null, chain: Array<{ id: number, name: string }> }>}
 */
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

/**
 * @param {Array<{ id: number, name: string, parent_id: number | null, is_top_level: boolean }>} roots
 * @returns {{ id: number, name: string } | null}
 */
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
			return Math.trunc(value);
		}
	}
	return null;
}

/**
 * @param {string} baseUrl
 * @param {string} authToken
 * @returns {Promise<{ ok: boolean, directory_id: number | null, probe_status: number | null, probe_note: string }>}
 */
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
 * @param {{
 *   baseUrl: string,
 *   authToken: string,
 *   userRecord?: Record<string, unknown>,
 *   anchorDirectoryId?: number | null,
 *   userDirectoryHints?: Array<{ field: string, value: unknown }>
 * }} options
 */
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
	}

	return { personalRootId, probe, accessibleRoots };
}

/**
 * @param {Array<{ id: number, name: string, parent_id: number | null, is_top_level: boolean }>} roots
 * @param {number | null} personalRootId
 * @returns {Record<string, number | null>}
 */
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

/**
 * @param {DiskSection} section
 * @param {Record<string, number | null>} sectionRoots
 * @param {number | null} personalRootId
 * @returns {number | null}
 */
function resolveSectionDirectoryId(section, sectionRoots, personalRootId) {
	if (section === 'docs') return personalRootId;
	return sectionRoots[section] ?? null;
}

/**
 * @param {string} baseUrl
 * @param {string} authToken
 * @param {number} directoryId
 * @returns {Promise<Array<{ id: number, name: string }>>}
 */
async function buildParentChain(baseUrl, authToken, directoryId) {
	/** @type {Array<{ id: number, name: string }>} */
	const chain = [];
	let currentId = directoryId;
	const visited = new Set();
	while (currentId > 0 && !visited.has(currentId)) {
		visited.add(currentId);
		const fetched = await fetchDirectoryEntry(baseUrl, authToken, currentId);
		if (!fetched.entry) break;
		const entry = fetched.entry;
		const entryId = typeof entry.Id === 'number' ? entry.Id : currentId;
		const name = typeof entry.Name === 'string' ? entry.Name.trim() : `id=${entryId}`;
		chain.unshift({ id: entryId, name });
		const parentId = readParentDirectoryId(entry);
		if (parentId == null || parentId === 0) break;
		currentId = parentId;
	}
	return chain;
}

/**
 * @param {number | null} personalRootId
 * @param {number} directoryId
 * @param {Array<{ id: number, name: string }>} parentChain
 * @returns {boolean}
 */
function isUnderPersonalRoot(personalRootId, directoryId, parentChain) {
	if (personalRootId == null) return false;
	if (directoryId === personalRootId) return true;
	return parentChain.some((c) => c.id === personalRootId);
}

/**
 * @param {Record<string, unknown> | null} entry
 * @returns {boolean}
 */
function isDirectoryEntryEmpty(entry) {
	if (!entry) return true;
	const folders = Array.isArray(entry.Children) ? entry.Children : [];
	const documents = Array.isArray(entry.Documents) ? entry.Documents : [];
	return folders.length === 0 && documents.length === 0;
}

/**
 * @param {number | null} personalRootId
 * @param {Array<{ id: number, name: string, parent_id: number | null, is_top_level: boolean }>} accessibleRoots
 * @param {Record<string, unknown> | null} [personalEntry]
 * @param {Record<string, unknown>} [userEnv]
 * @returns {{ storage_state: StorageState, create_target: Record<string, unknown> | null }}
 */
function assessStorageState(personalRootId, accessibleRoots, personalEntry = null, userEnv = {}) {
	const defaultParent = parsePositiveId(userEnv.R7_DISK_DEFAULT_PARENT_DIRECTORY_ID);

	if (personalRootId != null) {
		const empty = isDirectoryEntryEmpty(personalEntry);
		const rootName =
			personalEntry && typeof personalEntry.Name === 'string'
				? personalEntry.Name
				: 'Мои документы';
		return {
			storage_state: empty ? 'personal_empty' : 'personal_with_content',
			create_target: {
				parent_directory_id: personalRootId,
				parent_name: rootName,
				disk_section: 'docs',
				can_create_here: true,
				create_hint: empty
					? `Личное хранилище «${rootName}» (id=${personalRootId}) пусто. Создайте папку: r7_disk_folder create с name — parent подставится автоматически.`
					: `Создание в «${rootName}» (id=${personalRootId}): r7_disk_folder create с name.`
			}
		};
	}

	const sharedTarget = pickSharedCreateTarget(accessibleRoots);
	if (sharedTarget != null || defaultParent != null) {
		const parentId = defaultParent ?? sharedTarget?.id ?? null;
		const parentName = sharedTarget?.name ?? `id=${parentId}`;
		return {
			storage_state: 'no_personal_only_shared',
			create_target:
				parentId != null
					? {
							parent_directory_id: parentId,
							parent_name: parentName,
							disk_section: 'shared_to_me',
							can_create_here: true,
							create_hint: `Личного «Мои документы» нет. Создание возможно в «${parentName}» (id=${parentId}) — укажите parent явно или попросите админа выдать личное хранилище.`
						}
					: null
		};
	}

	return {
		storage_state: 'no_accessible_roots',
		create_target: null
	};
}

/**
 * @param {DiskSection} section
 * @param {number} directoryId
 * @returns {string}
 */
function buildWebUrlHint(section, directoryId) {
	const pathMap = {
		docs: 'docs',
		shared_to_me: 'shared-to-me',
		shared_access: 'shared-access',
		favorites: 'favorites',
		common: 'common',
		recycle_bin: 'recycle-bin',
		recent: 'recent',
		file_depot: 'fileDepot'
	};
	const path = pathMap[section] ?? 'docs';
	return `/${path}/${directoryId}`;
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
 * @typedef {Object} SkillKeyValueStorage
 * @property {(key: string) => unknown} get
 * @property {(key: string, value: string) => void} set
 */

/**
 * @param {SkillKeyValueStorage | null} skillStorage
 * @param {string} loginEmail
 */
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

/**
 * @param {SkillKeyValueStorage | null} skillStorage
 * @param {{
 *   personalRootId: number | null,
 *   accessibleRoots: Array<{ id: number, name: string, parent_id: number | null, is_top_level: boolean }>,
 *   sectionRoots: Record<string, number | null>,
 *   storageState: StorageState,
 *   createTarget: Record<string, unknown> | null
 * }} data
 */
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

/**
 * @param {SkillKeyValueStorage | null} skillStorage
 * @returns {{ personalRootId: number | null, sectionRoots: Record<string, number | null>, storageState: StorageState | null, createTarget: Record<string, unknown> | null }}
 */
function readRootsFromStorage(skillStorage) {
	if (!skillStorage) {
		return {
			personalRootId: null,
			sectionRoots: {},
			storageState: null,
			createTarget: null
		};
	}
	const personalRootId = parsePositiveId(skillStorage.get('r7_disk_my_documents_directory_id'));
	let sectionRoots = {};
	const sectionRaw = skillStorage.get('r7_disk_section_roots');
	if (typeof sectionRaw === 'string' && sectionRaw.trim()) {
		try {
			sectionRoots = JSON.parse(sectionRaw);
		} catch {
			sectionRoots = {};
		}
	}
	const storageStateRaw = skillStorage.get('r7_disk_storage_state');
	const storageState =
		typeof storageStateRaw === 'string' && storageStateRaw.trim()
			? /** @type {StorageState} */ (storageStateRaw.trim())
			: null;
	let createTarget = null;
	const createRaw = skillStorage.get('r7_disk_create_target');
	if (typeof createRaw === 'string' && createRaw.trim()) {
		try {
			createTarget = JSON.parse(createRaw);
		} catch {
			createTarget = null;
		}
	}
	return { personalRootId, sectionRoots, storageState, createTarget };
}
