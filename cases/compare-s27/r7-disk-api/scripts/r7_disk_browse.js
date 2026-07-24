/**
 * Recursively browse R7-Disk directory tree up to max_depth.
 * @param {Record<string, unknown>} state
 * @param {{
 *   directory_id?: unknown,
 *   disk_section?: unknown,
 *   web_url?: unknown,
 *   max_depth?: unknown,
 *   auth_token?: unknown,
 *   base_url?: unknown,
 *   login?: unknown,
 *   password?: unknown
 * }} params
 */
async function handler(state, params) {
	const userEnv = readUserEnv(state);
	const skillStorage = resolveSkillStorage(state);

	const baseUrl = resolveBaseUrl(state, params, skillStorage);
	const login = pickString(params?.login, userEnv.R7_DISK_LOGIN);
	const password = pickString(params?.password, userEnv.R7_DISK_PASSWORD);
	const maxDepth = resolveMaxDepth(params?.max_depth);

	if (!baseUrl) {
		return { ok: false, tree: null, error: 'Не задан R7_DISK_BASE_URL.' };
	}

	let authToken = typeof params?.auth_token === 'string' ? params.auth_token.trim() : '';
	if (!authToken && skillStorage) {
		const cached = skillStorage.get('r7_disk_auth_token');
		if (typeof cached === 'string' && cached.trim()) authToken = cached.trim();
	}
	if (!authToken) {
		const loginResult = await loginInline(baseUrl, login, password, skillStorage);
		if (!loginResult.ok) return { ok: false, tree: null, error: loginResult.error };
		authToken = loginResult.auth_token;
	}

	const resolved = await resolveBrowseRoot({
		params,
		baseUrl,
		authToken,
		skillStorage,
		userEnv
	});
	if (!resolved.ok) {
		return { ok: false, tree: null, error: resolved.error };
	}
	const myDocumentsId = resolved.personal_root_id;
	const diskSection = resolved.disk_section;

	const folderPath =
		typeof params?.folder_path === 'string' ? params.folder_path.trim() : '';
	const folderName =
		typeof params?.folder_name === 'string' ? params.folder_name.trim() : '';
	const explicitDirectoryId = parsePositiveId(params?.directory_id);
	const webParsed = parseWebDiskUrl(params?.web_url);
	const webDirectoryId = webParsed?.directory_id ?? null;

	let directoryId = explicitDirectoryId ?? webDirectoryId ?? resolved.directory_id;
	let resolvedFromName = false;

	if ((folderPath || folderName) && myDocumentsId == null) {
		return {
			ok: false,
			tree: null,
			error:
				'Для поиска папки по имени нужен личный корень. Сначала r7_disk_login или укажите web_url / directory_id.'
		};
	}
	if (directoryId == null) {
		return {
			ok: false,
			tree: null,
			error: 'Не определён каталог для обхода. Выполните r7_disk_login или передайте web_url.'
		};
	}

	if (folderPath) {
		const resolved = await resolveDirectoryByPath(
			baseUrl,
			authToken,
			myDocumentsId,
			folderPath
		);
		if (resolved == null) {
			return {
				ok: false,
				tree: null,
				error: `Папка по пути «${folderPath}» не найдена под «Мои документы».`
			};
		}
		directoryId = resolved;
		resolvedFromName = true;
	} else if (folderName && explicitDirectoryId == null) {
		const resolved = await findDirectoryIdByName(
			baseUrl,
			authToken,
			myDocumentsId,
			folderName
		);
		if (resolved == null) {
			return {
				ok: false,
				tree: null,
				error: `Папка «${folderName}» не найдена в «Мои документы». Проверьте имя или укажите folder_path.`
			};
		}
		directoryId = resolved;
		resolvedFromName = true;
	}

	try {
		const tree = await fetchDirectoryNode(baseUrl, authToken, directoryId, maxDepth, 1);
		const flat = flattenTree(/** @type {Record<string, unknown>} */ (tree), '');
		const rootName = typeof tree.name === 'string' ? tree.name : '';
		const rootId = typeof tree.id === 'number' ? tree.id : directoryId;
		const treeText = formatTreeText(/** @type {Record<string, unknown>} */ (tree));
		const parentChain = await buildParentChain(baseUrl, authToken, rootId);
		const stored = readRootsFromStorage(skillStorage);
		const isPersonalTree = isUnderPersonalRoot(myDocumentsId, rootId, parentChain);
		const scopeWarning =
			myDocumentsId != null && !isPersonalTree && diskSection === 'docs'
				? 'Каталог вне личного «Мои документы» — возможно общий или расшаренный.'
				: '';
		persistBrowseDocumentsIndex(skillStorage, flat.documents);
		return withFactualCitation(
			{
				ok: true,
				tree,
				tree_text: treeText,
				all_documents: flat.documents,
				all_folders: flat.folders,
				total_documents: flat.documents.length,
				total_folders: flat.folders.length,
				max_depth: maxDepth,
				browse_root_id: rootId,
				browse_root_name: rootName,
				disk_section: diskSection,
				parent_chain: parentChain,
				is_personal_tree: isPersonalTree,
				web_url_hint: buildWebUrlHint(diskSection, rootId),
				scope_warning: scopeWarning || undefined,
				resolved_via_folder_name: resolvedFromName,
				browse_scope_note: `Дерево от «${rootName}» (id=${rootId}), глубина ${maxDepth}. Подпапки — в tree / tree_text; все файлы — all_documents.`,
				agent_message: `Дерево папок от «${rootName}» (id=${rootId}): ${flat.folders.length} папок, ${flat.documents.length} файлов в обходе. Покажите пользователю tree_text.`,
				do_not_retry: true,
				forbid_followup_tools: [
					'r7_disk_browse',
					'browse',
					'r7_disk_list_directory',
					'list_directory'
				],
				api_base_url: baseUrl
			},
			['tree_text', 'all_documents', 'all_folders', 'browse_scope_note']
		);
	} catch (err) {
		return { ok: false, tree: null, error: errorMessage(err) };
	}
}

/**
 * Собирает плоский список файлов и папок из дерева browse.
 * @param {Record<string, unknown>} node
 * @param {string} pathPrefix
 * @returns {{ documents: Array<Record<string, unknown>>, folders: Array<Record<string, unknown>> }}
 */
/**
 * @param {string} fileName
 * @returns {string}
 */
function browseDocumentNameKey(fileName) {
	return fileName.trim().toLowerCase();
}

/**
 * @param {SkillKeyValueStorage | null} skillStorage
 * @param {Array<Record<string, unknown>>} documents
 */
function persistBrowseDocumentsIndex(skillStorage, documents) {
	if (!skillStorage || !Array.isArray(documents)) return;
	for (const doc of documents) {
		if (!doc || typeof doc !== 'object') continue;
		const name = typeof doc.name === 'string' ? doc.name.trim() : '';
		const documentId = parsePositiveId(doc.id);
		const directoryId = parsePositiveId(doc.directory_id);
		if (!name || documentId == null || directoryId == null) continue;
		const payload = JSON.stringify({
			document_id: documentId,
			directory_id: directoryId,
			file_name: name,
			updated_at: Date.now()
		});
		skillStorage.set(`r7_disk_doc_id_${directoryId}_${browseDocumentNameKey(name)}`, payload);
		skillStorage.set(`r7_disk_last_browse_doc_${browseDocumentNameKey(name)}`, payload);
	}
}

function flattenTree(node, pathPrefix) {
	const name = typeof node.name === 'string' ? node.name : '';
	const currentPath = pathPrefix ? `${pathPrefix}/${name}` : name;
	const dirId = typeof node.id === 'number' ? node.id : null;

	/** @type {Array<Record<string, unknown>>} */
	const documents = [];
	/** @type {Array<Record<string, unknown>>} */
	const folders = [];

	if (dirId != null && name) {
		folders.push({ id: dirId, name, path: currentPath || name });
	}

	const docs = Array.isArray(node.documents) ? node.documents : [];
	for (const d of docs) {
		if (!d || typeof d !== 'object') continue;
		const doc = /** @type {Record<string, unknown>} */ (d);
		documents.push({
			id: doc.id,
			name: doc.name,
			mimeType: doc.mimeType,
			size: doc.size,
			folder_path: currentPath || name,
			directory_id: dirId
		});
	}

	const childFolders = Array.isArray(node.folders) ? node.folders : [];
	for (const child of childFolders) {
		if (!child || typeof child !== 'object') continue;
		const folder = /** @type {Record<string, unknown>} */ (child);
		if (folder.truncated === true) {
			const childName = typeof folder.name === 'string' ? folder.name : '';
			folders.push({
				id: folder.id,
				name: childName,
				path: currentPath ? `${currentPath}/${childName}` : childName,
				truncated: true
			});
			continue;
		}
		const sub = flattenTree(folder, currentPath);
		documents.push(...sub.documents);
		folders.push(...sub.folders);
	}

	return { documents, folders };
}

/**
 * ASCII-дерево для ответа агенту (копировать в чат как есть).
 * @param {Record<string, unknown>} node
 * @param {string} indent
 * @returns {string}
 */
function formatTreeText(node, indent = '') {
	const name = typeof node.name === 'string' ? node.name : '?';
	const folderCount =
		typeof node.folderCount === 'number' ? node.folderCount : 0;
	const documentCount =
		typeof node.documentCount === 'number' ? node.documentCount : 0;
	/** @type {string[]} */
	const lines = [
		`${indent}${name}/ (${folderCount} подпапок, ${documentCount} файлов на этом уровне)`
	];

	const docs = Array.isArray(node.documents) ? node.documents : [];
	for (const d of docs) {
		if (!d || typeof d !== 'object') continue;
		const doc = /** @type {Record<string, unknown>} */ (d);
		const docName = typeof doc.name === 'string' ? doc.name : '?';
		const size = typeof doc.size === 'number' ? doc.size : 0;
		lines.push(`${indent}  [файл] ${docName} (${size} байт)`);
	}

	const childFolders = Array.isArray(node.folders) ? node.folders : [];
	for (const child of childFolders) {
		if (!child || typeof child !== 'object') continue;
		const folder = /** @type {Record<string, unknown>} */ (child);
		if (folder.truncated === true) {
			const childName = typeof folder.name === 'string' ? folder.name : '?';
			lines.push(`${indent}  ${childName}/ … (глубже лимита обхода)`);
			continue;
		}
		lines.push(formatTreeText(folder, `${indent}  `));
	}

	return lines.join('\n');
}

/**
 * @param {string} baseUrl
 * @param {string} authToken
 * @param {number} rootId
 * @param {string} pathStr
 * @returns {Promise<number | null>}
 */
async function resolveDirectoryByPath(baseUrl, authToken, rootId, pathStr) {
	const segments = pathStr
		.split('/')
		.map((s) => s.trim())
		.filter(Boolean);
	let currentId = rootId;
	for (const segment of segments) {
		const entry = await fetchDirectoryEntryForBrowse(baseUrl, authToken, currentId);
		if (!entry) return null;
		const children = Array.isArray(entry.Children) ? entry.Children : [];
		const match = children.find(
			(c) =>
				c &&
				typeof c === 'object' &&
				typeof c.Name === 'string' &&
				c.Name.trim() === segment
		);
		if (!match || typeof match.Id !== 'number') return null;
		currentId = match.Id;
	}
	return currentId;
}

/**
 * Ищет папку по имени: сначала среди детей root, затем BFS на глубину 4.
 * @param {string} baseUrl
 * @param {string} authToken
 * @param {number} rootId
 * @param {string} folderName
 * @returns {Promise<number | null>}
 */
async function findDirectoryIdByName(baseUrl, authToken, rootId, folderName) {
	const target = folderName.trim();
	/** @type {Array<{ id: number, depth: number }>} */
	const queue = [{ id: rootId, depth: 0 }];
	const visited = new Set();

	while (queue.length > 0) {
		const current = queue.shift();
		if (!current || visited.has(current.id)) continue;
		visited.add(current.id);

		const entry = await fetchDirectoryEntryForBrowse(baseUrl, authToken, current.id);
		if (!entry) continue;

		const children = Array.isArray(entry.Children) ? entry.Children : [];
		for (const child of children) {
			if (!child || typeof child !== 'object' || typeof child.Id !== 'number') continue;
			const name = typeof child.Name === 'string' ? child.Name.trim() : '';
			if (name === target) return child.Id;
			if (current.depth < 4) {
				queue.push({ id: child.Id, depth: current.depth + 1 });
			}
		}
	}
	return null;
}

/**
 * @param {string} baseUrl
 * @param {string} authToken
 * @param {number} directoryId
 * @param {number} maxDepth
 * @param {number} currentDepth
 */
async function fetchDirectoryNode(baseUrl, authToken, directoryId, maxDepth, currentDepth) {
	const url = `${baseUrl}/api/v1/DocumentDirectory/Get?id=${encodeURIComponent(String(directoryId))}`;
	const response = await fetch(url, {
		method: 'GET',
		headers: {
			'Content-Type': 'application/json',
			Authorization: authToken
		}
	});
	const rawText = await readUtf8Text(response);
	if (!response.ok) {
		throw new Error(`Get id=${directoryId} HTTP ${response.status}: ${truncate(rawText, 200)}`);
	}
	let payload;
	try {
		payload = rawText ? JSON.parse(rawText) : [];
	} catch {
		throw new Error(`Get id=${directoryId}: ответ не JSON.`);
	}
	const entries = Array.isArray(payload) ? payload : [payload];
	const entry = entries.find((item) => item && typeof item === 'object') ?? entries[0];
	if (!entry || typeof entry !== 'object') {
		throw new Error(`Get id=${directoryId}: пустой ответ.`);
	}

	/** @type {Array<Record<string, unknown>>} */
	const childFolders = [];
	const rawChildren = Array.isArray(entry.Children) ? entry.Children : [];
	if (currentDepth < maxDepth) {
		for (const child of rawChildren) {
			if (!child || typeof child !== 'object' || typeof child.Id !== 'number') continue;
			const subtree = await fetchDirectoryNode(
				baseUrl,
				authToken,
				child.Id,
				maxDepth,
				currentDepth + 1
			);
			childFolders.push(subtree);
		}
	} else {
		for (const child of rawChildren) {
			if (!child || typeof child !== 'object') continue;
			childFolders.push({
				id: child.Id,
				name: child.Name,
				truncated: true
			});
		}
	}

	const documents = Array.isArray(entry.Documents)
		? entry.Documents.filter((d) => d && typeof d === 'object').map((d) => ({
				id: d.Id,
				name: d.Name,
				mimeType: d.MimeType,
				size: d.Size
			}))
		: [];

	return {
		id: entry.Id,
		name: entry.Name,
		parentId: entry.ParentId,
		folders: childFolders,
		documents,
		documentCount: documents.length,
		folderCount: rawChildren.length
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

async function resolveBrowseRoot(ctx) {
	const { params, baseUrl, authToken, skillStorage, userEnv } = ctx;
	const fromLoginParam = parsePositiveId(params.my_documents_directory_id);
	if (fromLoginParam != null) {
		return {
			ok: true,
			directory_id: fromLoginParam,
			personal_root_id: fromLoginParam,
			disk_section: 'docs'
		};
	}
	const webParsed = parseWebDiskUrl(params.web_url);
	const section =
		normalizeDiskSection(params.disk_section) ?? webParsed?.section ?? 'docs';
	const stored = readRootsFromStorage(skillStorage);
	let personalRootId = stored.personalRootId;
	if (personalRootId == null) {
		const quick = await resolvePersonalRootQuick(baseUrl, authToken, userEnv, skillStorage);
		personalRootId = quick.personalRootId;
		if (personalRootId != null && skillStorage) {
			skillStorage.set('r7_disk_my_documents_directory_id', String(personalRootId));
		}
	}
	const sectionId =
		section === 'docs'
			? personalRootId
			: typeof stored.sectionRoots[section] === 'number'
				? stored.sectionRoots[section]
				: null;
	if (sectionId == null && parsePositiveId(params.directory_id) == null && !webParsed?.directory_id) {
		return {
			ok: false,
			error:
				'Не удалось определить корень browse. Сначала r7_disk_login или передайте my_documents_directory_id / directory_id из ответа login.',
			hint: 'После login: r7_disk_browse { my_documents_directory_id: <из login> }'
		};
	}
	return {
		ok: true,
		directory_id: sectionId ?? personalRootId,
		personal_root_id: personalRootId,
		disk_section: section
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

function readRootsFromStorage(skillStorage) {
	if (!skillStorage) {
		return { personalRootId: null, sectionRoots: {}, storageState: null, createTarget: null };
	}
	let personalRootId = parsePositiveId(skillStorage.get('r7_disk_my_documents_directory_id'));
	if (personalRootId == null) {
		personalRootId = pickPersonalRootFromAccessibleRoots(skillStorage);
	}
	let sectionRoots = {};
	const sectionRaw = skillStorage.get('r7_disk_section_roots');
	if (typeof sectionRaw === 'string' && sectionRaw.trim()) {
		try {
			sectionRoots = JSON.parse(sectionRaw);
		} catch {
			sectionRoots = {};
		}
	}
	return { personalRootId, sectionRoots, storageState: null, createTarget: null };
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
		for (const item of roots) {
			if (!item || typeof item !== 'object') continue;
			const record = /** @type {Record<string, unknown>} */ (item);
			const id = parsePositiveId(record.id);
			const parentId = record.parent_id;
			const isTop = record.is_top_level === true || parentId == null || parentId === 0;
			const name = typeof record.name === 'string' ? record.name.trim() : '';
			if (id != null && isTop && /мои\s*документ|my\s*documents/i.test(name)) return id;
		}
	} catch {
		return null;
	}
	return null;
}

const BROWSE_SCAN_BATCH_SIZE = 12;
const BROWSE_SCAN_MAX_ID = 256;

/**
 * @param {number} [maxId]
 * @returns {number[]}
 */
function buildBrowseScanIds(maxId = BROWSE_SCAN_MAX_ID) {
	const limit = Math.max(32, Math.min(maxId, BROWSE_SCAN_MAX_ID));
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
function chunkBrowseIds(ids, size) {
	/** @type {number[][]} */
	const out = [];
	for (let i = 0; i < ids.length; i += size) out.push(ids.slice(i, i + size));
	return out;
}

/**
 * @param {string} baseUrl
 * @param {string} authToken
 * @param {SkillKeyValueStorage | null} skillStorage
 */
async function resolvePersonalRootQuick(baseUrl, authToken, userEnv, skillStorage) {
	const fromRoots = pickPersonalRootFromAccessibleRoots(skillStorage);
	if (fromRoots != null) return { personalRootId: fromRoots };

	for (const candidateId of [1, 0]) {
		const entry = await fetchDirectoryEntryForBrowse(baseUrl, authToken, candidateId);
		if (!entry) continue;
		const entryId = typeof entry.Id === 'number' ? entry.Id : candidateId;
		const name = typeof entry.Name === 'string' ? entry.Name : '';
		if (looksLikeMyDocumentsRoot(entry, name)) {
			return { personalRootId: entryId };
		}
	}

	/** @type {{ id: number, name: string } | null} */
	let fallback = null;
	for (const batch of chunkBrowseIds(buildBrowseScanIds(), BROWSE_SCAN_BATCH_SIZE)) {
		const fetched = await Promise.all(
			batch.map(async (id) => ({
				id,
				entry: await fetchDirectoryEntryForBrowse(baseUrl, authToken, id)
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
		const entry = await fetchDirectoryEntryForBrowse(baseUrl, authToken, currentId);
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
async function fetchDirectoryEntryForBrowse(baseUrl, authToken, directoryId) {
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

/** Максимальная глубина рекурсивного обхода (уровни папок). */
const BROWSE_MAX_DEPTH_CAP = 8;

/**
 * @param {unknown} value
 * @returns {number}
 */
function resolveMaxDepth(value) {
	if (typeof value === 'number' && Number.isFinite(value) && value >= 1) {
		return Math.min(Math.floor(value), BROWSE_MAX_DEPTH_CAP);
	}
	if (typeof value === 'string' && value.trim()) {
		const parsed = Number(value.trim());
		if (Number.isFinite(parsed) && parsed >= 1) {
			return Math.min(Math.floor(parsed), BROWSE_MAX_DEPTH_CAP);
		}
	}
	/** По умолчанию — достаточно для типичного дерева «Мои документы» без настройки пользователем. */
	return 5;
}

/**
 * @param {string} baseUrl
 * @param {string} login
 * @param {string} password
 * @param {SkillKeyValueStorage | null} skillStorage
 */
async function loginInline(baseUrl, login, password, skillStorage) {
	if (!login || !password) {
		return { ok: false, error: 'Нет auth_token и не заданы учётные данные для авто-login.' };
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