/**
 * List folders and documents in an R7-Disk directory.
 * @param {Record<string, unknown>} state
 * @param {{
 *   directory_id?: unknown,
 *   disk_section?: unknown,
 *   web_url?: unknown,
 *   auth_token?: unknown,
 *   base_url?: unknown,
 *   login?: unknown,
 *   password?: unknown,
 *   force_repeat?: unknown
 * }} params
 */
async function handler(state, params) {
	const userEnv = readUserEnv(state);
	const skillStorage = resolveSkillStorage(state);

	const baseUrl = resolveBaseUrl(state, params, skillStorage);
	const login = pickString(params?.login, userEnv.R7_DISK_LOGIN);
	const password = pickString(params?.password, userEnv.R7_DISK_PASSWORD);
	if (!baseUrl) {
		return { ok: false, error: 'Не задан R7_DISK_BASE_URL.' };
	}

	let authToken = typeof params?.auth_token === 'string' ? params.auth_token.trim() : '';
	let authFromCache = Boolean(authToken);
	if (!authToken && skillStorage) {
		const cached = skillStorage.get('r7_disk_auth_token');
		if (typeof cached === 'string' && cached.trim()) {
			authToken = cached.trim();
			authFromCache = true;
		}
	}

	if (!authToken) {
		const loginResult = await loginInline(baseUrl, login, password, skillStorage);
		if (!loginResult.ok) return loginResult;
		authToken = loginResult.auth_token;
		authFromCache = false;
	}

	const resolved = await resolveListingDirectoryId({
		params,
		baseUrl,
		authToken,
		skillStorage,
		userEnv
	});
	if (!resolved.ok) {
		return { ok: false, error: resolved.error };
	}
	const directoryId = resolved.directory_id;
	const diskSection = resolved.disk_section;

	const listingDedupHit = resolveListingDedupHit(skillStorage, directoryId, diskSection, params);
	if (listingDedupHit) {
		return withSessionAuthHints(listingDedupHit, authFromCache);
	}

	const listBlockedAfterRead = resolveListBlockedAfterRead(skillStorage, directoryId, params);
	if (listBlockedAfterRead) {
		return withSessionAuthHints(listBlockedAfterRead, authFromCache);
	}

	const url = `${baseUrl}/api/v1/DocumentDirectory/Get?id=${encodeURIComponent(String(directoryId))}`;
	let response;
	try {
		response = await fetch(url, {
			method: 'GET',
			headers: {
				'Content-Type': 'application/json',
				Authorization: authToken
			}
		});
	} catch (err) {
		return {
			ok: false,
			error: `Сетевая ошибка Get: ${errorMessage(err)}`
		};
	}

	const rawText = await readUtf8Text(response);
	if (!response.ok) {
		const guessedId = directoryId <= 10;
		const accessDenied = response.status === 403 || response.status === 406;
		return {
			ok: false,
			error: `DocumentDirectory/Get HTTP ${response.status}: ${truncate(rawText, 300)}`,
			...(accessDenied && guessedId
				? {
						do_not_guess_directory_ids: true,
						forbid_directory_id_probe: true,
						agent_message:
							`Нет доступа к папке id=${directoryId}. **Не перебирайте** id 1–4 и другие «наугад». ` +
							'Спросите у пользователя **имя папки** или URL `/docs/N`, либо вызовите `r7_disk_browse` с `folder_name`.',
						hint:
							'После login с `my_documents_directory_id: null` — один вопрос пользователю, не серия list_directory с разными id.'
					}
				: {})
		};
	}

	let payload;
	try {
		payload = rawText ? JSON.parse(rawText) : [];
	} catch {
		return { ok: false, error: `Get: ответ не JSON: ${truncate(rawText, 300)}` };
	}

	const entries = Array.isArray(payload) ? payload : [payload];
	const entry = entries.find((item) => item && typeof item === 'object') ?? entries[0];
	if (!entry || typeof entry !== 'object') {
		return { ok: false, error: 'Пустой ответ DocumentDirectory/Get.' };
	}

	const stored = readRootsFromStorage(skillStorage);
	const folders = normalizeFolderList(entry.Children);
	const rawDocuments = normalizeDocumentList(entry.Documents);
	const dirId = typeof entry.Id === 'number' ? entry.Id : directoryId;
	const dirName = typeof entry.Name === 'string' ? entry.Name : '';
	const effectiveDiskSection = inferEffectiveDiskSection(
		diskSection ?? 'docs',
		dirId,
		dirName,
		stored.sectionRoots
	);
	const strictDocumentFilter = shouldStrictFilterDocuments(
		effectiveDiskSection,
		dirId,
		dirName,
		stored.sectionRoots
	);
	const documents = strictDocumentFilter
		? filterDocumentsForDirectory(rawDocuments, dirId)
		: rawDocuments;
	const documentsFilteredOut = strictDocumentFilter
		? rawDocuments.length - documents.length
		: 0;
	const parent =
		entry.Parent && typeof entry.Parent === 'object' ? entry.Parent : null;
	const parentId =
		parent && typeof parent.Id === 'number' ? parent.Id : null;
	const parentName =
		parent && typeof parent.Name === 'string' ? parent.Name : null;

	const parentChain = await buildParentChain(baseUrl, authToken, dirId);
	let personalRootId = stored.personalRootId;
	if (personalRootId == null) {
		const inferred = inferPersonalRootFromListing(parentId, parentName, parentChain);
		if (inferred != null) {
			personalRootId = inferred.id;
			persistPersonalRootToStorage(skillStorage, inferred.id, inferred.name);
		}
	}
	const isPersonalTree = isUnderPersonalRoot(personalRootId, dirId, parentChain);
	const isVirtualSection = !strictDocumentFilter;
	const isEmpty = folders.length === 0 && documents.length === 0;

	/** @type {string} */
	let listing_scope_note;
	if (documentsFilteredOut > 0 && isEmpty) {
		listing_scope_note =
			`Папка «${dirName}» (id=${dirId}): пусто. ` +
			`API вернул ${documentsFilteredOut} файл(ов) из других папок — отфильтрованы по DirectoryId.`;
	} else if (isEmpty) {
		listing_scope_note = `Папка «${dirName}» (id=${dirId}): пусто — нет подпапок и файлов.`;
	} else if (parentId != null && parentName) {
		listing_scope_note = `Папка «${dirName}» (id=${dirId}), родитель: «${parentName}» (id=${parentId}).`;
	} else if (isVirtualSection) {
		listing_scope_note = `Раздел «${dirName}» (id=${dirId}, disk_section=${effectiveDiskSection}).`;
	} else {
		listing_scope_note = `Папка «${dirName}» (id=${dirId}) — корень запроса (disk_section=${effectiveDiskSection}).`;
	}

	const scopeWarning =
		personalRootId != null && !isPersonalTree && effectiveDiskSection === 'docs'
			? 'Каталог вне личного «Мои документы» — возможно общий или расшаренный.'
			: '';

	const storageState =
		dirId === personalRootId && isEmpty
			? 'personal_empty'
			: dirId === personalRootId
				? 'personal_with_content'
				: stored.storageState;

	const subfoldersOnlyAtRoot =
		dirId === personalRootId &&
		folders.length > 0 &&
		documents.length === 0 &&
		!isVirtualSection;
	const listingAgentMessage = isEmpty
		? isVirtualSection
			? `${listing_scope_note} В этом разделе пока нет расшаренных файлов.`
			: `${listing_scope_note} Можно создать папку или файл — см. create_target.`
		: subfoldersOnlyAtRoot
			? `${listing_scope_note} Файлы лежат в подпапках — вызовите r7_disk_browse (directory_id=${dirId}) и покажите all_documents.`
			: listing_scope_note;

	const listingResult = withFactualCitation(
			{
				ok: true,
				directory_id: dirId,
				directory_name: dirName,
				disk_section: effectiveDiskSection,
				is_virtual_section: isVirtualSection,
				parent,
				parent_directory_id: parentId,
				parent_directory_name: parentName,
				parent_chain: parentChain,
				is_personal_tree: isPersonalTree,
				is_empty: isEmpty,
				storage_state: storageState,
				create_target: stored.createTarget,
				web_url_hint: buildWebUrlHint(effectiveDiskSection, dirId),
				scope_warning: scopeWarning || undefined,
				listing_scope_note,
				...(documentsFilteredOut > 0
					? { documents_filtered_out: documentsFilteredOut }
					: {}),
				...(subfoldersOnlyAtRoot
					? {
							subfolders_only: true,
							needs_browse_for_files: true,
							browse_hint: {
								tool: 'r7_disk_browse',
								directory_id: dirId,
								my_documents_directory_id: dirId
							}
						}
					: {}),
				folders,
				documents,
				counters: entry.Counters && typeof entry.Counters === 'object' ? entry.Counters : null,
				agent_message: listingAgentMessage,
				api_base_url: baseUrl
			},
			['folders', 'documents', 'listing_scope_note', 'directory_name', 'directory_id']
			);

	persistListingDedup(skillStorage, dirId, effectiveDiskSection, listingResult);

	const forbidAfterList = subfoldersOnlyAtRoot
		? ['r7_disk_list_directory', 'list_directory', 'r7_disk_login']
		: ['r7_disk_list_directory', 'list_directory', 'r7_disk_browse', 'browse', 'r7_disk_login'];

	return withSessionAuthHints(
		/** @type {Record<string, unknown> & { ok: boolean }} */ ({
			...listingResult,
			do_not_retry: subfoldersOnlyAtRoot ? false : true,
			...(subfoldersOnlyAtRoot ? { agent_stop: false } : {}),
			forbid_followup_tools: forbidAfterList
		}),
		authFromCache
	);
}

/**
 * @param {number} directoryId
 * @param {string} diskSection
 * @returns {string}
 */
function buildListingDedupKey(directoryId, diskSection) {
	return `r7_disk_list_done_${diskSection}_${directoryId}`;
}

/**
 * @param {SkillKeyValueStorage | null} skillStorage
 * @param {number} directoryId
 * @param {string} diskSection
 * @param {Record<string, unknown>} params
 * @returns {(Record<string, unknown> & { ok: boolean }) | null}
 */
function resolveListingDedupHit(skillStorage, directoryId, diskSection, params) {
	if (!skillStorage || params?.force_repeat === true) return null;
	const raw = skillStorage.get(buildListingDedupKey(directoryId, diskSection));
	if (typeof raw !== 'string' || !raw.trim()) return null;
	try {
		const cached = /** @type {Record<string, unknown>} */ (JSON.parse(raw));
		if (cached.ok === false) return null;
		const msg =
			typeof cached.agent_message === 'string' ? cached.agent_message : 'Содержимое папки уже получено.';
		return {
			...cached,
			ok: true,
			already_completed: true,
			do_not_retry: true,
			forbid_followup_tools: [
				'r7_disk_list_directory',
				'list_directory',
				'r7_disk_browse',
				'browse',
				'r7_disk_login'
			],
			agent_message: msg.includes('повтор') ? msg : `${msg} Повторный list_directory не нужен.`
		};
	} catch {
		return null;
	}
}

/**
 * @param {SkillKeyValueStorage | null} skillStorage
 * @param {number} directoryId
 * @param {string} diskSection
 * @param {Record<string, unknown>} result
 */
/**
 * @param {SkillKeyValueStorage | null} skillStorage
 * @param {number} directoryId
 * @param {Record<string, unknown>} params
 * @returns {(Record<string, unknown> & { ok: boolean }) | null}
 */
function resolveListBlockedAfterRead(skillStorage, directoryId, params) {
	if (!skillStorage || params?.force_repeat === true) return null;
	const raw = skillStorage.get(`r7_disk_block_list_after_read_${directoryId}`);
	if (typeof raw !== 'string' || !raw.trim()) return null;
	let fileName = 'файла';
	try {
		const parsed = /** @type {Record<string, unknown>} */ (JSON.parse(raw));
		if (typeof parsed.file_name === 'string' && parsed.file_name.trim()) {
			fileName = parsed.file_name.trim();
		}
	} catch {
		if (raw !== '1') fileName = raw;
	}
	return {
		ok: true,
		already_completed: true,
		directory_id: directoryId,
		do_not_retry: true,
		agent_stop: true,
		agent_message:
			`Содержимое «${fileName}» уже получено через read_content. ` +
			'list_directory не нужен — выведите пользователю content_text из предыдущего ответа.',
		forbid_followup_tools: [
			'r7_disk_list_directory',
			'list_directory',
			'r7_disk_document',
			'read_content',
			'r7_disk_download',
			'download',
			'r7_disk_browse',
			'browse'
		]
	};
}

function persistListingDedup(skillStorage, directoryId, diskSection, result) {
	if (!skillStorage || result.ok === false) return;
	skillStorage.set(
		buildListingDedupKey(directoryId, diskSection),
		JSON.stringify({
			ok: true,
			directory_id: result.directory_id,
			directory_name: result.directory_name,
			disk_section: result.disk_section,
			folders: result.folders,
			documents: result.documents,
			listing_scope_note: result.listing_scope_note,
			agent_message: result.agent_message,
			at: Date.now()
		})
	);
}

/**
 * @param {Record<string, unknown> & { ok: boolean }} result
 * @param {boolean} authFromCache
 * @returns {Record<string, unknown> & { ok: boolean, auth_from_cache: boolean, forbid_followup_tools: string[], session_note?: string }}
 */
function withSessionAuthHints(result, authFromCache) {
	const record = /** @type {Record<string, unknown>} */ (/** @type {unknown} */ (result));
	const existing = Array.isArray(record.forbid_followup_tools)
		? /** @type {string[]} */ (record.forbid_followup_tools)
		: [];
	const merged = [...new Set([...existing, 'r7_disk_login'])];
	return {
		...result,
		auth_from_cache: authFromCache,
		...(authFromCache
			? {
					session_note:
						'Токен из skillStorage. **Не** вызывайте r7_disk_login повторно в этой сессии.',
					forbid_followup_tools: merged
				}
			: { forbid_followup_tools: merged })
	};
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
 * @param {{
 *   params: Record<string, unknown>,
 *   baseUrl: string,
 *   authToken: string,
 *   skillStorage: SkillKeyValueStorage | null,
 *   userEnv: Record<string, unknown>
 * }} ctx
 */
async function resolveListingDirectoryId(ctx) {
	const { params, baseUrl, authToken, skillStorage, userEnv } = ctx;
	const fromLoginParam = parsePositiveId(params.my_documents_directory_id);
	if (fromLoginParam != null) {
		return { ok: true, directory_id: fromLoginParam, disk_section: 'docs' };
	}
	const webParsed = parseWebDiskUrl(params.web_url);
	const section =
		normalizeDiskSection(params.disk_section) ??
		webParsed?.section ??
		'docs';

	const explicitId = parsePositiveId(params.directory_id) ?? webParsed?.directory_id;
	if (explicitId != null) {
		return { ok: true, directory_id: explicitId, disk_section: section };
	}

	const stored = readRootsFromStorage(skillStorage);
	let personalRootId = stored.personalRootId;
	if (personalRootId == null) {
		const resolved = await resolvePersonalRootQuick(baseUrl, authToken, userEnv, skillStorage);
		personalRootId = resolved.personalRootId;
		if (personalRootId != null && skillStorage) {
			skillStorage.set('r7_disk_my_documents_directory_id', String(personalRootId));
		}
	}

	const sectionRoots = stored.sectionRoots;
	const sectionId =
		section === 'docs'
			? personalRootId
			: typeof sectionRoots[section] === 'number'
				? sectionRoots[section]
				: null;

	if (sectionId != null) {
		return { ok: true, directory_id: sectionId, disk_section: section };
	}

	if (section !== 'docs') {
		return {
			ok: false,
			error: `Раздел «${section}» не привязан к API id. Сначала r7_disk_login или укажите directory_id / web_url.`
		};
	}

	return {
		ok: false,
		error:
			'Не удалось определить «Мои документы». Сначала r7_disk_login; передайте my_documents_directory_id или directory_id из ответа login.',
		hint: 'Для списка всех файлов предпочтительнее r7_disk_browse с my_documents_directory_id.'
	};
}

/**
 * @param {unknown} value
 * @returns {number | null}
 */
function parsePositiveId(value) {
	if (typeof value === 'number' && Number.isFinite(value) && value > 0) return value;
	if (typeof value === 'string' && value.trim()) {
		const parsed = Number(value.trim());
		if (Number.isFinite(parsed) && parsed > 0) return parsed;
	}
	return null;
}

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
		rawSection === 'filedepot' ? 'file_depot' : rawSection.replace(/-/g, '_');
	const section = WEB_SECTION_PATHS[sectionKey] ?? WEB_SECTION_PATHS[rawSection];
	if (!section) return null;
	const idPart = match[2];
	const directoryId =
		idPart && Number.isFinite(Number(idPart)) && Number(idPart) > 0
			? Math.trunc(Number(idPart))
			: null;
	return { section, directory_id: directoryId };
}

function normalizeDiskSection(value) {
	if (typeof value !== 'string' || !value.trim()) return null;
	const key = value.trim().toLowerCase().replace(/-/g, '_');
	return WEB_SECTION_PATHS[key] ?? null;
}

/**
 * @param {SkillKeyValueStorage | null} skillStorage
 * @returns {{
 *   personalRootId: number | null,
 *   sectionRoots: Record<string, unknown>,
 *   storageState: string | null,
 *   createTarget: unknown
 * }}
 */
function readRootsFromStorage(skillStorage) {
	if (!skillStorage) {
		return {
			personalRootId: null,
			sectionRoots: /** @type {Record<string, unknown>} */ ({}),
			storageState: null,
			createTarget: null
		};
	}
	let personalRootId = parsePositiveId(skillStorage.get('r7_disk_my_documents_directory_id'));
	if (personalRootId == null) {
		personalRootId = pickPersonalRootFromAccessibleRoots(skillStorage);
	}
	/** @type {Record<string, unknown>} */
	let sectionRoots = {};
	const sectionRaw = skillStorage.get('r7_disk_section_roots');
	if (typeof sectionRaw === 'string' && sectionRaw.trim()) {
		try {
			const parsed = JSON.parse(sectionRaw);
			if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
				sectionRoots = /** @type {Record<string, unknown>} */ (parsed);
			}
		} catch {
			sectionRoots = {};
		}
	}
	const storageStateRaw = skillStorage.get('r7_disk_storage_state');
	const storageState = typeof storageStateRaw === 'string' ? storageStateRaw : null;
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

/**
 * @param {SkillKeyValueStorage | null} skillStorage
 * @returns {number | null}
 */
function pickPersonalRootFromAccessibleRoots(skillStorage) {
	if (!skillStorage) return null;
	const raw = skillStorage.get('r7_disk_accessible_roots');
	if (typeof raw !== 'string' || !raw.trim()) return null;
	try {
		const roots = JSON.parse(raw);
		if (!Array.isArray(roots)) return null;
		for (const item of roots) {
			if (!item || typeof item !== 'object') continue;
			const record = /** @type {Record<string, unknown>} */ (item);
			const name = typeof record.name === 'string' ? record.name.trim() : '';
			const id = parsePositiveId(record.id);
			if (id != null && /мои\s*документ|my\s*documents/i.test(name)) return id;
		}
	} catch {
		return null;
	}
	return null;
}

const LIST_SCAN_BATCH_SIZE = 12;
const LIST_SCAN_MAX_ID = 256;

/**
 * @param {number} [maxId]
 * @returns {number[]}
 */
function buildListScanIds(maxId = LIST_SCAN_MAX_ID) {
	const limit = Math.max(32, Math.min(maxId, LIST_SCAN_MAX_ID));
	/** @type {number[]} */
	const ids = [];
	for (let i = 2; i <= Math.min(128, limit); i++) ids.push(i);
	for (let i = 129; i <= limit; i++) ids.push(i);
	return ids;
}

/**
 * @param {number[]} ids
 * @param {number} size
 * @returns {number[][]}
 */
function chunkListIds(ids, size) {
	/** @type {number[][]} */
	const out = [];
	for (let i = 0; i < ids.length; i += size) out.push(ids.slice(i, i + size));
	return out;
}

/**
 * @param {string} baseUrl
 * @param {string} authToken
 * @param {Record<string, unknown>} userEnv
 * @param {SkillKeyValueStorage | null} skillStorage
 */
async function resolvePersonalRootQuick(baseUrl, authToken, userEnv, skillStorage) {
	const fromRoots = pickPersonalRootFromAccessibleRoots(skillStorage);
	if (fromRoots != null) return { personalRootId: fromRoots };

	for (const candidateId of [1, 0]) {
		const entry = await fetchDirectoryEntry(baseUrl, authToken, candidateId);
		if (!entry) continue;
		const entryId = typeof entry.Id === 'number' ? entry.Id : candidateId;
		const name = typeof entry.Name === 'string' ? entry.Name : '';
		if (looksLikeMyDocumentsRoot(entry, name)) {
			return { personalRootId: entryId };
		}
	}

	/** @type {{ id: number, name: string } | null} */
	let fallback = null;
	for (const batch of chunkListIds(buildListScanIds(), LIST_SCAN_BATCH_SIZE)) {
		const fetched = await Promise.all(
			batch.map(async (id) => ({
				id,
				entry: await fetchDirectoryEntry(baseUrl, authToken, id)
			}))
		);
		for (const item of fetched) {
			if (!item.entry) continue;
			const entry = item.entry;
			const name = typeof entry.Name === 'string' ? entry.Name : '';
			const entryId = typeof entry.Id === 'number' ? entry.Id : item.id;
			if (/мои\s*документ|my\s*documents/i.test(name.trim())) {
				return { personalRootId: entryId };
			}
			if (fallback == null && looksLikeMyDocumentsRoot(entry, name)) {
				fallback = { id: entryId, name: name.trim() || `id=${entryId}` };
			}
		}
		if (fallback != null) break;
	}
	if (fallback != null) return { personalRootId: fallback.id };

	const defaultParent = parsePositiveId(userEnv.R7_DISK_DEFAULT_PARENT_DIRECTORY_ID);
	if (defaultParent != null) return { personalRootId: defaultParent };
	return { personalRootId: null };
}

function readParentDirectoryId(entry) {
	const parentRaw =
		entry.Parent && typeof entry.Parent === 'object' ? entry.Parent : null;
	const parent = parentRaw ? /** @type {Record<string, unknown>} */ (parentRaw) : null;
	if (parent && typeof parent.Id === 'number') return parent.Id;
	if (typeof entry.ParentId === 'number') return entry.ParentId;
	return null;
}

function looksLikeMyDocumentsRoot(entry, name) {
	const parentId = readParentDirectoryId(entry);
	if (parentId == null || parentId === 0) {
		return !/^(общ|common|shared|корзин|избран|ладкрафт)/i.test(name.trim());
	}
	return /мои\s*документ|my\s*documents|^documents$/i.test(name.trim());
}

async function buildParentChain(baseUrl, authToken, directoryId) {
	/** @type {Array<{ id: number, name: string }>} */
	const chain = [];
	let currentId = directoryId;
	const visited = new Set();
	while (currentId > 0 && !visited.has(currentId)) {
		visited.add(currentId);
		const entry = await fetchDirectoryEntry(baseUrl, authToken, currentId);
		if (!entry) break;
		const entryId = typeof entry.Id === 'number' ? entry.Id : currentId;
		const name = typeof entry.Name === 'string' ? entry.Name.trim() : `id=${entryId}`;
		chain.unshift({ id: entryId, name });
		const parentId = readParentDirectoryId(entry);
		if (parentId == null || parentId === 0) break;
		currentId = parentId;
	}
	return chain;
}

function isUnderPersonalRoot(personalRootId, directoryId, parentChain) {
	if (personalRootId == null) return false;
	if (directoryId === personalRootId) return true;
	return parentChain.some((c) => c.id === personalRootId);
}

/**
 * @param {number | null} parentId
 * @param {string | null} parentName
 * @param {Array<{ id: number, name: string }>} parentChain
 * @returns {{ id: number, name: string } | null}
 */
function inferPersonalRootFromListing(parentId, parentName, parentChain) {
	if (parentId != null && parentName && looksLikeMyDocumentsName(parentName)) {
		return { id: parentId, name: parentName.trim() };
	}
	if (parentChain.length > 0) {
		const top = parentChain[0];
		if (top && looksLikeMyDocumentsName(top.name)) {
			return { id: top.id, name: top.name };
		}
	}
	return null;
}

/**
 * @param {string} name
 * @returns {boolean}
 */
function looksLikeMyDocumentsName(name) {
	return /мои\s*документ|my\s*documents|^documents$/i.test(String(name).trim());
}

/**
 * @param {SkillKeyValueStorage | null} skillStorage
 * @param {number} personalRootId
 * @param {string} [directoryName]
 */
function persistPersonalRootToStorage(skillStorage, personalRootId, directoryName) {
	if (!skillStorage || personalRootId == null) return;
	skillStorage.set('r7_disk_my_documents_directory_id', String(personalRootId));
	skillStorage.set('r7_disk_section_roots', JSON.stringify({ docs: personalRootId }));
	skillStorage.set('r7_disk_storage_state', 'personal_with_content');
	skillStorage.set('r7_disk_create_target', '');
}


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
 * @param {string} baseUrl
 * @param {string} authToken
 * @param {number} directoryId
 * @returns {Promise<Record<string, unknown> | null>}
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
		return null;
	}
	if (!response.ok) return null;
	const rawText = await readUtf8Text(response);
	try {
		const payload = rawText ? JSON.parse(rawText) : [];
		const entries = Array.isArray(payload) ? payload : [payload];
		const entry = entries.find((item) => item && typeof item === 'object');
		return entry && typeof entry === 'object' ? /** @type {Record<string, unknown>} */ (entry) : null;
	} catch {
		return null;
	}
}

/**
 * @param {string} baseUrl
 * @param {string} login
 * @param {string} password
 * @param {SkillKeyValueStorage | null} skillStorage
 */
async function loginInline(baseUrl, login, password, skillStorage) {
	if (!login || !password) {
		return { ok: false, error: 'Нет auth_token и не заданы R7_DISK_LOGIN/R7_DISK_PASSWORD для авто-login.' };
	}
	const url = `${baseUrl}/api/v2/auth/Login`;
	const response = await fetch(url, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json; charset=utf-8' },
		body: JSON.stringify({ Login: login, Password: password })
	});
	const rawText = await readUtf8Text(response);
	let payload;
	try {
		payload = rawText ? JSON.parse(rawText) : {};
	} catch {
		return { ok: false, error: `Login: ответ не JSON (HTTP ${response.status}).` };
	}
	if (!response.ok) {
		return { ok: false, error: `Login HTTP ${response.status}: ${truncate(rawText, 300)}` };
	}
	const authToken = payload?.Response?.Data?.Tokens?.AuthToken;
	if (typeof authToken !== 'string' || !authToken) {
		return { ok: false, error: 'Login: AuthToken не найден.' };
	}
	if (skillStorage) {
		skillStorage.set('r7_disk_auth_token', authToken);
		skillStorage.set('r7_disk_base_url', baseUrl);
	}
	return { ok: true, auth_token: authToken };
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
 * @param {unknown} children
 * @returns {Array<Record<string, unknown>>}
 */
function normalizeFolderList(children) {
	if (!Array.isArray(children)) return [];
	return children
		.filter((item) => item && typeof item === 'object')
		.map((item) => ({
			Id: item.Id,
			Name: item.Name,
			ParentId: item.ParentId,
			Type: item.Type,
			Size: item.Size,
			Timestamp: item.Timestamp,
			IsShared: item.IsShared
		}));
}

/**
 * @param {unknown} documents
 * @returns {Array<Record<string, unknown>>}
 */
function normalizeDocumentList(documents) {
	if (!Array.isArray(documents)) return [];
	return documents
		.filter((item) => item && typeof item === 'object')
		.map((item) => {
			const docId = typeof item.Id === 'number' ? item.Id : null;
			const ownerDirId =
				typeof item.DirectoryId === 'number'
					? item.DirectoryId
					: typeof item.ParentId === 'number'
						? item.ParentId
						: null;
			const docName = typeof item.Name === 'string' ? item.Name : '';
			const isShared = item.IsShared === true || Boolean(item.Author);
			/** @type {Record<string, unknown>} */
			const row = {
				Id: docId,
				document_id: docId,
				Name: docName,
				DirectoryId: ownerDirId,
				owner_directory_id: ownerDirId,
				ParentId: item.ParentId,
				MimeType: item.MimeType,
				Size: item.Size,
				Date: item.Date,
				Timestamp: item.Timestamp,
				IsShared: item.IsShared,
				FileId: item.FileId,
				Author: extractDocumentAuthor(item)
			};
			if (isShared && docId != null && docName) {
				row.shared_edit_example = {
					operation: 'prepend',
					document_id: docId,
					name: docName,
					directory_id: ownerDirId,
					content_text: '…'
				};
			}
			return row;
		});
}

/**
 * @param {Array<Record<string, unknown>>} documents
 * @param {number} directoryId
 * @returns {Array<Record<string, unknown>>}
 */
const VIRTUAL_DISK_SECTIONS = new Set([
	'shared_to_me',
	'shared_access',
	'common',
	'favorites',
	'recent',
	'recycle_bin',
	'file_depot'
]);

/**
 * Определяет раздел по id корня из login (когда агент передал только directory_id).
 * @param {string} diskSection
 * @param {number} directoryId
 * @param {string} dirName
 * @param {Record<string, unknown>} sectionRoots
 * @returns {string}
 */
function inferEffectiveDiskSection(diskSection, directoryId, dirName, sectionRoots) {
	for (const [section, id] of Object.entries(sectionRoots)) {
		if (typeof id === 'number' && id === directoryId) return section;
	}
	if (/доступно\s*для\s*меня/i.test(dirName)) return 'shared_to_me';
	if (/совместн/i.test(dirName)) return 'shared_access';
	if (/^общ/i.test(dirName)) return 'common';
	if (/избран/i.test(dirName)) return 'favorites';
	if (/корзин/i.test(dirName)) return 'recycle_bin';
	if (/последн/i.test(dirName)) return 'recent';
	if (/хранилищ/i.test(dirName)) return 'file_depot';
	return diskSection;
}

/**
 * Строгий фильтр DirectoryId только для личного дерева «Мои документы».
 * В «Доступно для меня» и др. API отдаёт файлы с DirectoryId исходной папки владельца.
 * @param {string} diskSection
 * @param {number} directoryId
 * @param {string} dirName
 * @param {Record<string, unknown>} sectionRoots
 * @returns {boolean}
 */
function shouldStrictFilterDocuments(diskSection, directoryId, dirName, sectionRoots) {
	if (VIRTUAL_DISK_SECTIONS.has(diskSection)) return false;
	if (looksLikeVirtualSectionName(dirName)) return false;
	for (const [section, id] of Object.entries(sectionRoots)) {
		if (section !== 'docs' && typeof id === 'number' && id === directoryId) return false;
	}
	return true;
}

/**
 * @param {string} dirName
 * @returns {boolean}
 */
function looksLikeVirtualSectionName(dirName) {
	return /^(доступно\s*для\s*меня|совместн|общ|избран|корзин|последн|хранилищ)/i.test(
		dirName.trim()
	);
}

/**
 * @param {Record<string, unknown>} item
 * @returns {string | null}
 */
function extractDocumentAuthor(item) {
	if (typeof item.Author === 'string' && item.Author.trim()) return item.Author.trim();
	if (item.Author && typeof item.Author === 'object') {
		const author = /** @type {Record<string, unknown>} */ (item.Author);
		if (typeof author.DisplayName === 'string' && author.DisplayName.trim()) {
			return author.DisplayName.trim();
		}
		const parts = [author.Surname, author.FirstName, author.Name]
			.filter((p) => typeof p === 'string' && p.trim())
			.map((p) => /** @type {string} */ (p).trim());
		if (parts.length > 0) return parts.join(' ');
	}
	for (const key of ['CreatedBy', 'Owner', 'User']) {
		const value = item[key];
		if (typeof value === 'string' && value.trim()) return value.trim();
		if (value && typeof value === 'object') {
			const record = /** @type {Record<string, unknown>} */ (value);
			if (typeof record.DisplayName === 'string' && record.DisplayName.trim()) {
				return record.DisplayName.trim();
			}
			if (typeof record.Name === 'string' && record.Name.trim()) return record.Name.trim();
		}
	}
	if (typeof item.CreatedByName === 'string' && item.CreatedByName.trim()) {
		return item.CreatedByName.trim();
	}
	return null;
}

/**
 * @param {Array<Record<string, unknown>>} documents
 * @param {number} directoryId
 * @returns {Array<Record<string, unknown>>}
 */
function filterDocumentsForDirectory(documents, directoryId) {
	return documents.filter((doc) => documentBelongsToDirectory(doc, directoryId));
}

/**
 * @param {Record<string, unknown>} doc
 * @param {number} directoryId
 * @returns {boolean}
 */
function documentBelongsToDirectory(doc, directoryId) {
	const docDirId = typeof doc.DirectoryId === 'number' ? doc.DirectoryId : null;
	if (docDirId != null) return docDirId === directoryId;
	const parentId = typeof doc.ParentId === 'number' ? doc.ParentId : null;
	if (parentId != null) return parentId === directoryId;
	return true;
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