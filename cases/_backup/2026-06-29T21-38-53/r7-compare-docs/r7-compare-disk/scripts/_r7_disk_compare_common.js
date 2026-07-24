const COMPARE_FOLDER_DEFAULT = 'CompareResults';
const TEMPLATES_FOLDER_NAME = 'templates';
const TEMPLATE_MAX_BYTES = 150000;
const DOCUMENT_MAX_BYTES = 200000;
const COMMON_ROOT_NAME_RE =
	/^(общ|common|shared|корзин|избран|ладкрафт|recycle|favorites?|recent|file\s*depot)/i;

const STORAGE_KEY_TEMPLATES_DIR = 'r7_disk_templates_directory_id';
const STORAGE_KEY_MY_DOCS = 'r7_disk_my_documents_directory_id';
const STORAGE_KEY_COMPARE_FOLDER = 'r7_disk_compare_results_folder_id';

function readUserEnv(state) {
	const env =
		state && state.environment && typeof state.environment === 'object' ? state.environment : {};
	return env.user && typeof env.user === 'object' ? env.user : {};
}

function resolveSkillStorage(state) {
	const caps =
		state && state.capabilities && typeof state.capabilities === 'object'
			? state.capabilities
			: {};
	for (const key of ['key-value-storage', 'keyValueStorage', 'skillStorage', 'kv']) {
		const adapter = caps[key];
		if (adapter && typeof adapter.get === 'function' && typeof adapter.set === 'function') {
			return adapter;
		}
	}
	return null;
}

function pickString(value) {
	if (typeof value === 'string' && value.trim()) return value.trim();
	return '';
}

function parsePositiveId(value) {
	if (typeof value === 'number' && Number.isFinite(value) && value > 0) return Math.floor(value);
	if (typeof value === 'string' && value.trim()) {
		const n = Number(value.trim());
		if (Number.isFinite(n) && n > 0) return Math.floor(n);
	}
	return null;
}

function errorMessage(err) {
	if (err && typeof err.message === 'string') return err.message;
	return String(err || 'unknown error');
}

function truncate(text, max) {
	const value = String(text || '');
	return value.length <= max ? value : value.slice(0, max) + '…';
}

function unwrapApiData(payload) {
	if (payload && typeof payload === 'object' && payload.Response) {
		const response = payload.Response;
		if (response && typeof response === 'object' && 'Data' in response) {
			return response.Data != null ? response.Data : payload;
		}
	}
	return payload;
}

async function readUtf8Text(response) {
	try {
		return await response.text();
	} catch {
		return '';
	}
}

function readDiskEnv(state) {
	const userEnv = readUserEnv(state);
	const baseUrl = pickString(userEnv.R7_DISK_BASE_URL).replace(/\/+$/, '');
	const login = pickString(userEnv.R7_DISK_LOGIN);
	const password = pickString(userEnv.R7_DISK_PASSWORD);
	return { baseUrl, login, password };
}

function missingDiskEnvError(missing) {
	return {
		ok: false,
		error: 'Не заданы параметры Р7-Диска: ' + missing.join(', '),
		agent_message:
			'Сравнение через диск недоступно: настройте ' + missing.join(', ') + ' при установке навыка.'
	};
}

const STANDARD_PROBE_IDS = [1, 0, 61, 5, 9, 42, 50];

function folderNamesMatch(a, b) {
	return String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();
}

function extractDirectoryIdFromUser(user) {
	if (!user || typeof user !== 'object') return null;
	const keys = [
		'DocumentsDirectoryId',
		'DocumentDirectoryId',
		'DirectoryId',
		'RootDirectoryId',
		'PersonalDirectoryId',
		'MyDocumentsDirectoryId'
	];
	for (let i = 0; i < keys.length; i += 1) {
		const value = user[keys[i]];
		const id = parsePositiveId(value);
		if (id != null) return id;
	}
	return null;
}

async function discoverStandardMyDocumentsProbe(baseUrl, authToken) {
	for (let i = 0; i < STANDARD_PROBE_IDS.length; i += 1) {
		const candidateId = STANDARD_PROBE_IDS[i];
		const fetched = await fetchDirectoryEntry(baseUrl, authToken, candidateId);
		if (!fetched.entry) continue;
		const entry = fetched.entry;
		const entryId = typeof entry.Id === 'number' ? entry.Id : candidateId;
		const name = typeof entry.Name === 'string' ? entry.Name : '';
		if (looksLikeMyDocumentsRoot(entry, name)) {
			return { ok: true, directory_id: entryId };
		}
	}
	return { ok: false, error: 'Стандартный корень «Мои документы» не найден.' };
}

async function fetchDocumentDirectoryId(baseUrl, authToken, documentId) {
	const url = baseUrl + '/api/v1/Documents/Get?id=' + encodeURIComponent(String(documentId));
	let response;
	try {
		response = await fetch(url, {
			method: 'GET',
			headers: { 'Content-Type': 'application/json', Authorization: authToken }
		});
	} catch (err) {
		return { ok: false, error: 'Сетевая ошибка Documents/Get: ' + errorMessage(err) };
	}
	if (!response.ok) {
		return { ok: false, error: 'Documents/Get HTTP ' + response.status };
	}
	const rawText = await readUtf8Text(response);
	try {
		const payload = rawText ? JSON.parse(rawText) : {};
		const data = unwrapApiData(payload);
		if (data && typeof data === 'object') {
			const dirId = parsePositiveId(data.DirectoryId != null ? data.DirectoryId : data.directory_id);
			if (dirId != null) return { ok: true, directory_id: dirId };
		}
	} catch {
		return { ok: false, error: 'Documents/Get: ответ не JSON.' };
	}
	return { ok: false, error: 'DirectoryId не найден в Documents/Get.' };
}

async function resolveMyDocumentsRoot(baseUrl, authToken, options) {
	const skillStorage = options && options.skillStorage ? options.skillStorage : null;
	const hostDocumentId =
		options && options.hostDocumentId != null ? options.hostDocumentId : null;
	const loginUser = options && options.loginUser ? options.loginUser : null;

	if (skillStorage) {
		const cached = parsePositiveId(skillStorage.get(STORAGE_KEY_MY_DOCS));
		if (cached != null) return { ok: true, directory_id: cached, source: 'cache' };
	}

	const fromUser = extractDirectoryIdFromUser(loginUser);
	if (fromUser != null) {
		if (skillStorage) skillStorage.set(STORAGE_KEY_MY_DOCS, String(fromUser));
		return { ok: true, directory_id: fromUser, source: 'login_user' };
	}

	if (hostDocumentId != null) {
		const docDir = await fetchDocumentDirectoryId(baseUrl, authToken, hostDocumentId);
		if (docDir.ok) {
			const climbed = await climbToPersonalRoot(baseUrl, authToken, docDir.directory_id);
			if (climbed.personal_root_id != null) {
				if (skillStorage) {
					skillStorage.set(STORAGE_KEY_MY_DOCS, String(climbed.personal_root_id));
				}
				return { ok: true, directory_id: climbed.personal_root_id, source: 'host_document_climb' };
			}
		}
	}

	const probed = await discoverStandardMyDocumentsProbe(baseUrl, authToken);
	if (probed.ok) {
		if (skillStorage) skillStorage.set(STORAGE_KEY_MY_DOCS, String(probed.directory_id));
		return { ok: true, directory_id: probed.directory_id, source: 'probe' };
	}

	return {
		ok: false,
		error: 'Не удалось определить корень «Мои документы».',
		agent_message:
			'Не удалось определить «Мои документы» на Р7-Диске. Откройте документ с диска и повторите.'
	};
}

async function findFolderByNameInsensitive(baseUrl, authToken, rootId, folderName, maxDepth) {
	const target = String(folderName || '').trim().toLowerCase();
	const depthLimit = typeof maxDepth === 'number' && maxDepth > 0 ? maxDepth : 4;
	const queue = [{ id: rootId, depth: 0 }];
	const visited = new Set();

	while (queue.length > 0) {
		const current = queue.shift();
		if (!current || visited.has(current.id)) continue;
		visited.add(current.id);

		const fetched = await fetchDirectoryEntry(baseUrl, authToken, current.id);
		if (!fetched.entry) continue;

		const children = Array.isArray(fetched.entry.Children) ? fetched.entry.Children : [];
		for (let i = 0; i < children.length; i += 1) {
			const child = children[i];
			if (!child || typeof child !== 'object' || typeof child.Id !== 'number') continue;
			const name = typeof child.Name === 'string' ? child.Name.trim() : '';
			if (folderNamesMatch(name, target)) return child.Id;
			if (current.depth < depthLimit) {
				queue.push({ id: child.Id, depth: current.depth + 1 });
			}
		}
	}
	return null;
}

async function resolveTemplatesDirectory(state, params, auth) {
	const raw = params && typeof params === 'object' ? params : {};
	const overrideId = parsePositiveId(raw.directory_id);
	const skillStorage = auth.skillStorage || resolveSkillStorage(state);

	if (overrideId != null) {
		return { ok: true, directory_id: overrideId, auto_discovered: false };
	}

	if (skillStorage) {
		const cached = parsePositiveId(skillStorage.get(STORAGE_KEY_TEMPLATES_DIR));
		if (cached != null) {
			const myDocs = parsePositiveId(skillStorage.get(STORAGE_KEY_MY_DOCS));
			return {
				ok: true,
				directory_id: cached,
				my_documents_directory_id: myDocs,
				auto_discovered: false
			};
		}
	}

	const hostDocumentId = parsePositiveId(raw.host_document_id);
	const myDocsResult = await resolveMyDocumentsRoot(auth.baseUrl, auth.authToken, {
		skillStorage: skillStorage,
		hostDocumentId: hostDocumentId,
		loginUser: auth.loginUser
	});
	if (!myDocsResult.ok) return myDocsResult;

	const templatesId = await findFolderByNameInsensitive(
		auth.baseUrl,
		auth.authToken,
		myDocsResult.directory_id,
		TEMPLATES_FOLDER_NAME,
		4
	);
	if (templatesId == null) {
		return {
			ok: false,
			error: 'Папка templates не найдена в «Мои документы».',
			agent_message:
				'Создайте папку templates в «Мои документы» и положите в неё файлы .md или .docx.'
		};
	}

	if (skillStorage) {
		skillStorage.set(STORAGE_KEY_TEMPLATES_DIR, String(templatesId));
		skillStorage.set(STORAGE_KEY_MY_DOCS, String(myDocsResult.directory_id));
	}

	return {
		ok: true,
		directory_id: templatesId,
		my_documents_directory_id: myDocsResult.directory_id,
		auto_discovered: true
	};
}

async function prepareCompareResultsCache(baseUrl, authToken, myDocumentsId, skillStorage) {
	if (myDocumentsId == null) {
		return { ok: false, error: 'Не задан id корня «Мои документы».' };
	}
	const folderResult = await ensureCompareFolder(
		baseUrl,
		authToken,
		myDocumentsId,
		COMPARE_FOLDER_DEFAULT
	);
	if (!folderResult.ok) {
		return { ok: false, error: folderResult.error };
	}
	if (skillStorage) {
		skillStorage.set(STORAGE_KEY_COMPARE_FOLDER, String(folderResult.folder_id));
	}
	return {
		ok: true,
		my_documents_directory_id: myDocumentsId,
		compare_results_folder_id: folderResult.folder_id,
		compare_folder_created: folderResult.created === true
	};
}

async function ensureDiskAuth(state) {
	const env = readDiskEnv(state);
	const missing = [];
	if (!env.baseUrl) missing.push('R7_DISK_BASE_URL');
	if (!env.login) missing.push('R7_DISK_LOGIN');
	if (!env.password) missing.push('R7_DISK_PASSWORD');
	if (missing.length) return { ok: false, ...missingDiskEnvError(missing) };

	const skillStorage = resolveSkillStorage(state);
	const loginResult = await diskLogin(env.baseUrl, env.login, env.password, skillStorage);
	if (!loginResult.ok) {
		return {
			ok: false,
			error: loginResult.error,
			agent_message: 'Не удалось войти в Р7-Диск: ' + loginResult.error
		};
	}
	return {
		ok: true,
		baseUrl: env.baseUrl,
		authToken: loginResult.auth_token,
		loginUser: loginResult.loginUser,
		skillStorage: skillStorage
	};
}

async function diskLogin(baseUrl, login, password, skillStorage) {
	const url = baseUrl + '/api/v2/auth/Login';
	let response;
	try {
		response = await fetch(url, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json; charset=utf-8' },
			body: JSON.stringify({ Login: login, Password: password })
		});
	} catch (err) {
		return { ok: false, error: 'Сетевая ошибка login: ' + errorMessage(err) };
	}

	const rawText = await readUtf8Text(response);
	let payload;
	try {
		payload = rawText ? JSON.parse(rawText) : {};
	} catch {
		return { ok: false, error: 'Login: ответ не JSON (HTTP ' + response.status + ')' };
	}
	if (!response.ok) {
		return { ok: false, error: 'Login HTTP ' + response.status + ': ' + truncate(rawText, 200) };
	}

	const tokens = payload && payload.Response && payload.Response.Data && payload.Response.Data.Tokens;
	const authToken = tokens && typeof tokens.AuthToken === 'string' ? tokens.AuthToken : '';
	const loginUser =
		payload && payload.Response && payload.Response.Data && payload.Response.Data.User
			? payload.Response.Data.User
			: null;
	if (!authToken) {
		return { ok: false, error: 'AuthToken не найден в ответе login.' };
	}

	if (skillStorage) {
		skillStorage.set('r7_disk_auth_token', authToken);
		skillStorage.set('r7_disk_base_url', baseUrl);
	}

	return { ok: true, auth_token: authToken, loginUser: loginUser };
}

function isCommonOrSharedRootName(name) {
	return COMMON_ROOT_NAME_RE.test(String(name || '').trim());
}

function readParentDirectoryId(entry) {
	if (!entry || typeof entry !== 'object') return null;
	const parentRaw = entry.Parent && typeof entry.Parent === 'object' ? entry.Parent : null;
	if (parentRaw && typeof parentRaw.Id === 'number') return parentRaw.Id;
	if (typeof entry.ParentId === 'number') return entry.ParentId;
	return null;
}

function looksLikeMyDocumentsRoot(entry, name) {
	const parentId = readParentDirectoryId(entry);
	if (parentId == null || parentId === 0) {
		return !isCommonOrSharedRootName(name);
	}
	return /мои\s*документ|my\s*documents|^documents$/i.test(String(name || '').trim());
}

async function climbToPersonalRoot(baseUrl, authToken, startId) {
	const chain = [];
	let currentId = startId;
	const visited = new Set();

	while (currentId > 0 && !visited.has(currentId)) {
		visited.add(currentId);
		const fetched = await fetchDirectoryEntry(baseUrl, authToken, currentId);
		if (!fetched.entry) break;
		const entry = fetched.entry;
		const entryId = typeof entry.Id === 'number' ? entry.Id : currentId;
		const name = typeof entry.Name === 'string' ? entry.Name.trim() : 'id=' + entryId;
		chain.push({ id: entryId, name: name });
		if (looksLikeMyDocumentsRoot(entry, name)) {
			return { personal_root_id: entryId, chain: chain };
		}
		const parentId = readParentDirectoryId(entry);
		if (parentId == null || parentId === 0) break;
		currentId = parentId;
	}

	for (let i = chain.length - 1; i >= 0; i -= 1) {
		if (/мои\s*документ|my\s*documents/i.test(chain[i].name)) {
			return { personal_root_id: chain[i].id, chain: chain };
		}
	}
	return { personal_root_id: null, chain: chain };
}

async function prepareCompareResultsFromTemplatesDir(
	baseUrl,
	authToken,
	templatesDirectoryId,
	skillStorage,
	knownMyDocsId
) {
	let myDocsId = knownMyDocsId != null ? knownMyDocsId : null;
	if (myDocsId == null && skillStorage) {
		myDocsId = parsePositiveId(skillStorage.get(STORAGE_KEY_MY_DOCS));
	}
	if (myDocsId == null) {
		const climbed = await climbToPersonalRoot(baseUrl, authToken, templatesDirectoryId);
		if (climbed.personal_root_id == null) {
			return {
				ok: false,
				error: 'Не найден корень «Мои документы» по цепочке Parent от templates.'
			};
		}
		myDocsId = climbed.personal_root_id;
		if (skillStorage) skillStorage.set(STORAGE_KEY_MY_DOCS, String(myDocsId));
	}
	return prepareCompareResultsCache(baseUrl, authToken, myDocsId, skillStorage);
}

async function fetchDirectoryEntry(baseUrl, authToken, directoryId) {
	const url =
		baseUrl + '/api/v1/DocumentDirectory/Get?id=' + encodeURIComponent(String(directoryId));
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
	if (!response.ok) return { entry: null, status: status };
	const rawText = await readUtf8Text(response);
	try {
		const payload = rawText ? JSON.parse(rawText) : [];
		const entries = Array.isArray(payload) ? payload : [payload];
		let entry = null;
		for (let i = 0; i < entries.length; i += 1) {
			if (entries[i] && typeof entries[i] === 'object') {
				entry = entries[i];
				break;
			}
		}
		return { entry: entry, status: status };
	} catch {
		return { entry: null, status: status };
	}
}

function normalizeFolderList(children) {
	const out = [];
	if (!Array.isArray(children)) return out;
	for (let i = 0; i < children.length; i += 1) {
		const item = children[i];
		if (!item || typeof item !== 'object') continue;
		const id = parsePositiveId(item.Id != null ? item.Id : item.id);
		const name = typeof item.Name === 'string' ? item.Name.trim() : '';
		if (id != null && name) out.push({ id: id, name: name });
	}
	return out;
}

async function apiRequest(method, url, authToken, body) {
	const init = {
		method: method,
		headers: {
			'Content-Type': 'application/json; charset=utf-8',
			Accept: 'application/json; charset=utf-8',
			Authorization: authToken
		}
	};
	if (body != null) {
		init.body = JSON.stringify(body);
	}
	let response;
	try {
		response = await fetch(url, init);
	} catch (err) {
		return { ok: false, error: errorMessage(err) };
	}
	const rawText = await readUtf8Text(response);
	let payload = null;
	if (rawText) {
		try {
			payload = JSON.parse(rawText);
		} catch {
			if (!response.ok) {
				return { ok: false, error: 'HTTP ' + response.status + ': ' + truncate(rawText, 200) };
			}
			payload = rawText;
		}
	}
	if (!response.ok) {
		return { ok: false, error: 'HTTP ' + response.status + ': ' + truncate(rawText, 300) };
	}
	return { ok: true, data: unwrapApiData(payload) };
}

function extractFolderId(payload) {
	const data = unwrapApiData(payload);
	if (typeof data === 'number' && Number.isFinite(data)) return data;
	if (data && typeof data === 'object') {
		if (typeof data.Id === 'number') return data.Id;
		if (typeof data.id === 'number') return data.id;
	}
	return null;
}

async function postAddSubDirectory(baseUrl, authToken, parentId, name) {
	const url = baseUrl + '/api/v1/DocumentDirectory/AddSubDirectory';
	const bodies = [
		{ ParentId: parentId, Name: name },
		{ DirectoryId: parentId, Name: name }
	];
	let lastError = '';
	for (let i = 0; i < bodies.length; i += 1) {
		const http = await apiRequest('POST', url, authToken, bodies[i]);
		if (http.ok) {
			return { ok: true, folder_id: extractFolderId(http.data) };
		}
		lastError = http.error || 'AddSubDirectory failed';
	}
	return { ok: false, error: lastError };
}

async function ensureCompareFolder(baseUrl, authToken, rootId, folderName) {
	const listing = await fetchDirectoryEntry(baseUrl, authToken, rootId);
	if (!listing.entry) {
		return { ok: false, error: 'Не удалось прочитать корень «Мои документы» (id=' + rootId + ').' };
	}

	const children = listing.entry.Children;
	const folders = normalizeFolderList(children);
	for (let i = 0; i < folders.length; i += 1) {
		const f = folders[i];
		if (f.name === folderName) {
			return { ok: true, folder_id: f.id, folder_name: folderName, created: false };
		}
	}

	const created = await postAddSubDirectory(baseUrl, authToken, rootId, folderName);
	if (!created.ok) {
		return { ok: false, error: created.error || 'Не удалось создать папку.' };
	}
	const folderId = created.folder_id;
	if (folderId == null) {
		return { ok: false, error: 'Папка создана, но ID не получен.' };
	}
	return { ok: true, folder_id: folderId, folder_name: folderName, created: true };
}

async function fetchDirectoryDocuments(baseUrl, authToken, directoryId) {
	const listing = await fetchDirectoryEntry(baseUrl, authToken, directoryId);
	if (!listing.entry) return [];
	const rawDocs = Array.isArray(listing.entry.Documents) ? listing.entry.Documents : [];
	return rawDocs.filter(function (doc) {
		if (!doc || typeof doc !== 'object') return false;
		const docDirId = typeof doc.DirectoryId === 'number' ? doc.DirectoryId : null;
		return docDirId == null || docDirId === directoryId;
	});
}

function isTemplateFileName(name) {
	const lower = String(name || '').trim().toLowerCase();
	return lower.endsWith('.md') || lower.endsWith('.docx');
}

function bytesToKb(sizeBytes) {
	if (typeof sizeBytes !== 'number' || !Number.isFinite(sizeBytes) || sizeBytes < 0) return 0;
	return Math.max(1, Math.round(sizeBytes / 1024));
}

async function findDocumentInDirectory(baseUrl, authToken, directoryId, requestedName) {
	const docs = await fetchDirectoryDocuments(baseUrl, authToken, directoryId);
	const trimmed = requestedName.trim().toLowerCase();
	const matches = [];
	for (let i = 0; i < docs.length; i += 1) {
		const doc = docs[i];
		const name = typeof doc.Name === 'string' ? doc.Name.trim() : '';
		if (!name) continue;
		const lower = name.toLowerCase();
		if (lower === trimmed) matches.push(doc);
		else if (!trimmed.includes('.') && lower.startsWith(trimmed + '.')) matches.push(doc);
	}
	if (matches.length === 0) {
		return {
			ok: false,
			error: 'Файл «' + requestedName + '» не найден в папке templates (id=' + directoryId + ').'
		};
	}
	matches.sort(function (a, b) {
		const aId = typeof a.Id === 'number' ? a.Id : 0;
		const bId = typeof b.Id === 'number' ? b.Id : 0;
		return bId - aId;
	});
	const picked = matches[0];
	const documentId = typeof picked.Id === 'number' ? picked.Id : null;
	const fileName = typeof picked.Name === 'string' ? picked.Name.trim() : requestedName;
	if (documentId == null) {
		return { ok: false, error: 'Не удалось определить document_id файла.' };
	}
	return { ok: true, document_id: documentId, file_name: fileName };
}

async function downloadDocumentBytes(baseUrl, authToken, documentId) {
	const downloadUrl =
		baseUrl +
		'/api/v1/Documents/Download?id=' +
		encodeURIComponent(String(documentId)) +
		'&_=' +
		Date.now();
	let response;
	try {
		response = await fetch(downloadUrl, {
			method: 'GET',
			headers: { Authorization: authToken }
		});
	} catch (err) {
		return { ok: false, error: 'Сетевая ошибка download: ' + errorMessage(err) };
	}
	if (!response.ok) {
		const errText = await readUtf8Text(response);
		return { ok: false, error: 'Download HTTP ' + response.status + ': ' + truncate(errText, 300) };
	}
	const buffer = await response.arrayBuffer();
	return { ok: true, bytes: new Uint8Array(buffer) };
}

function decodeUtf8(bytes) {
	if (typeof TextDecoder !== 'undefined') {
		return new TextDecoder('utf-8').decode(bytes);
	}
	let out = '';
	for (let i = 0; i < bytes.length; i += 1) out += String.fromCharCode(bytes[i]);
	try {
		return decodeURIComponent(escape(out));
	} catch {
		return out;
	}
}

function readZipEntries(bytes) {
	const entries = [];
	let offset = 0;
	while (offset + 30 <= bytes.length) {
		const view = new DataView(bytes.buffer, bytes.byteOffset + offset, bytes.byteLength - offset);
		const sig = view.getUint32(0, true);
		if (sig !== 0x04034b50) break;
		const compMethod = view.getUint16(8, true);
		const compSize = view.getUint32(18, true);
		const uncompSize = view.getUint32(22, true);
		const nameLen = view.getUint16(26, true);
		const extraLen = view.getUint16(28, true);
		const nameStart = offset + 30;
		const nameEnd = nameStart + nameLen;
		if (nameEnd > bytes.length) break;
		const name = decodeUtf8(bytes.subarray(nameStart, nameEnd));
		const dataStart = nameEnd + extraLen;
		const dataEnd = dataStart + compSize;
		if (dataEnd > bytes.length) break;
		let data = bytes.subarray(dataStart, dataEnd);
		if (compMethod === 0) {
			data = data.subarray(0, Math.min(data.length, uncompSize));
		}
		entries.push({ name: name, data: data });
		offset = dataEnd;
	}
	return entries;
}

function extractDocxPlainText(bytes) {
	const entries = readZipEntries(bytes);
	for (let i = 0; i < entries.length; i += 1) {
		if (entries[i].name === 'word/document.xml') {
			const xml = decodeUtf8(entries[i].data);
			const chunks = [];
			const regex = /<w:t[^>]*>([\s\S]*?)<\/w:t>/g;
			let match = regex.exec(xml);
			while (match) {
				chunks.push(
					match[1]
						.replace(/&lt;/g, '<')
						.replace(/&gt;/g, '>')
						.replace(/&amp;/g, '&')
						.replace(/&quot;/g, '"')
						.replace(/&apos;/g, "'")
				);
				match = regex.exec(xml);
			}
			return chunks.join('\n');
		}
	}
	return '';
}

function extractTextFromBytes(bytes, fileName) {
	const lower = String(fileName || '').toLowerCase();
	if (lower.endsWith('.docx')) {
		return extractDocxPlainText(bytes);
	}
	return decodeUtf8(bytes);
}

function truncateUtf8Text(text, maxBytes) {
	const encoded = encodeUtf8(text);
	if (encoded.length <= maxBytes) {
		return { text: text, truncated: false, bytes_read: encoded.length };
	}
	let end = maxBytes;
	while (end > 0 && (encoded[end] & 0xc0) === 0x80) end -= 1;
	return {
		text: decodeUtf8(encoded.subarray(0, end)),
		truncated: true,
		bytes_read: end
	};
}

function encodeUtf8(text) {
	if (typeof TextEncoder !== 'undefined') {
		return new TextEncoder().encode(text);
	}
	const out = [];
	for (let i = 0; i < text.length; i += 1) {
		let c = text.charCodeAt(i);
		if (c < 0x80) out.push(c);
		else if (c < 0x800) {
			out.push(0xc0 | (c >> 6), 0x80 | (c & 0x3f));
		} else {
			out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f));
		}
	}
	return new Uint8Array(out);
}

async function fetchDocumentText(baseUrl, authToken, documentId, fileName, maxBytes) {
	const downloaded = await downloadDocumentBytes(baseUrl, authToken, documentId);
	if (!downloaded.ok) return downloaded;
	const rawText = extractTextFromBytes(downloaded.bytes, fileName);
	if (!rawText || !rawText.trim()) {
		return { ok: false, error: 'Не удалось извлечь текст из файла «' + fileName + '».' };
	}
	const limited = truncateUtf8Text(rawText, maxBytes);
	return {
		ok: true,
		text: limited.text,
		truncated: limited.truncated,
		bytes_read: limited.bytes_read,
		document_id: documentId,
		file_name: fileName,
		source: 'r7-disk'
	};
}
