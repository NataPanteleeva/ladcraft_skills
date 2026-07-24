const STORAGE_KEY_AUTH_TOKEN = 'r7_disk_auth_token';
const STORAGE_KEY_BASE_URL = 'r7_disk_base_url';
const STORAGE_KEY_MY_DOCS = 'r7_disk_my_documents_directory_id';
const STORAGE_KEY_ACCESSIBLE_ROOTS = 'r7_disk_accessible_roots';
const STORAGE_KEY_SECTION_ROOTS = 'r7_disk_section_roots';
const BROWSE_SCAN_BATCH_SIZE = 12;
const BROWSE_SCAN_MAX_ID = 256;
const REPORT_FOLDER_SCAN_MAX_ID = 220;
const MY_DOCS_NAME_RE = /мои\s*документ|my\s*documents/i;

function asObject(value) {
	if (value && typeof value === 'object') return value;
	return null;
}

function pickString() {
	for (let i = 0; i < arguments.length; i += 1) {
		const value = arguments[i];
		if (typeof value === 'string' && value.trim()) return value.trim();
		if (value && typeof value === 'object' && typeof value.value === 'string' && value.value.trim()) {
			return value.value.trim();
		}
	}
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

function resolveSkillStorage(state) {
	const caps = asObject(state && state.capabilities);
	if (!caps) return null;
	for (const key of ['key-value-storage', 'keyValueStorage', 'skillStorage', 'kv']) {
		const adapter = caps[key];
		if (adapter && typeof adapter.get === 'function' && typeof adapter.set === 'function') {
			return adapter;
		}
	}
	return null;
}

function readUserEnv(state) {
	const env = asObject(state && state.environment);
	const user = asObject(env && env.user);
	return user || {};
}

function readDiskEnv(state, params, skillStorage) {
	const userEnv = readUserEnv(state);
	let baseUrl = pickString(
		params && params.base_url,
		skillStorage && skillStorage.get(STORAGE_KEY_BASE_URL),
		userEnv.R7_DISK_BASE_URL
	);
	let login = pickString(params && params.login, userEnv.R7_DISK_LOGIN);
	let password = pickString(params && params.password, userEnv.R7_DISK_PASSWORD);
	// __PUBLISH_ENV_FALLBACK__
	return {
		baseUrl: pickString(baseUrl).replace(/\/+$/, ''),
		login: pickString(login),
		password: pickString(password)
	};
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

function pickDirectoryEntry(payload) {
	if (payload == null) return null;
	if (Array.isArray(payload)) {
		for (let i = 0; i < payload.length; i += 1) {
			if (payload[i] && typeof payload[i] === 'object' && !Array.isArray(payload[i])) {
				return payload[i];
			}
		}
		return null;
	}
	const data = unwrapApiData(payload);
	if (Array.isArray(data)) {
		for (let i = 0; i < data.length; i += 1) {
			if (data[i] && typeof data[i] === 'object' && !Array.isArray(data[i])) return data[i];
		}
		return null;
	}
	if (data && typeof data === 'object') return data;
	return null;
}

async function safeJson(response) {
	const text = await response.text();
	if (!text) return {};
	try {
		return JSON.parse(text);
	} catch {
		return {};
	}
}

function normalizeFolderList(entry) {
	const data = pickDirectoryEntry(entry);
	if (!data || typeof data !== 'object') return [];
	const children = Array.isArray(data.Children) ? data.Children : [];
	return children
		.map(function (child) {
			const id = parsePositiveId(child && child.Id);
			const name = pickString(child && child.Title, child && child.Name) || 'Без названия';
			if (id == null) return null;
			return { directory_id: id, name: name };
		})
		.filter(Boolean);
}

function normalizeCsvList(entry, ext) {
	const data = pickDirectoryEntry(entry);
	if (!data || typeof data !== 'object') return [];
	const documents = Array.isArray(data.Documents) ? data.Documents : [];
	const suffix = String(ext || '.csv').toLowerCase();
	return documents
		.map(function (doc) {
			const name = pickString(doc && doc.Name);
			const id = parsePositiveId(doc && doc.Id);
			const size = typeof doc.Size === 'number' && Number.isFinite(doc.Size) ? doc.Size : 0;
			const directoryId = parsePositiveId(doc && doc.DirectoryId);
			if (!name || id == null) return null;
			if (!name.toLowerCase().endsWith(suffix)) return null;
			return {
				name: name,
				document_id: id,
				csv_document_id: id,
				directory_id: directoryId,
				size_kb: Math.round((size / 1024) * 10) / 10
			};
		})
		.filter(Boolean)
		.sort(function (a, b) {
			return String(a.name).localeCompare(String(b.name), 'ru');
		});
}

async function fetchDirectoryEntry(baseUrl, authToken, directoryId) {
	const url = `${baseUrl}/api/v1/DocumentDirectory/Get?id=${encodeURIComponent(String(directoryId))}`;
	let response;
	try {
		response = await fetch(url, {
			method: 'GET',
			headers: {
				Authorization: authToken,
				'Content-Type': 'application/json'
			}
		});
	} catch (err) {
		return { ok: false, error: `Сетевая ошибка Get: ${String(err && err.message ? err.message : err)}` };
	}
	const payload = await safeJson(response);
	if (!response.ok) {
		return { ok: false, error: `Get HTTP ${response.status}`, payload: payload };
	}
	const entry = pickDirectoryEntry(payload);
	return { ok: true, payload: payload, entry: entry };
}

async function login(baseUrl, loginValue, password) {
	let response;
	try {
		response = await fetch(`${baseUrl}/api/v2/auth/Login`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ Login: loginValue, Password: password })
		});
	} catch (err) {
		return { ok: false, error: `Сетевая ошибка Login: ${String(err && err.message ? err.message : err)}` };
	}
	const payload = await safeJson(response);
	if (!response.ok) {
		return { ok: false, error: `Login HTTP ${response.status}`, payload: payload };
	}
	const token = pickString(
		payload && payload.Response && payload.Response.Data && payload.Response.Data.Tokens && payload.Response.Data.Tokens.AuthToken
	);
	if (!token) return { ok: false, error: 'Login: не получен AuthToken.' };
	const user = payload && payload.Response && payload.Response.Data && payload.Response.Data.User;
	const rootId = parsePositiveId(
		user && (user.DocumentsDirectoryId || user.documentsDirectoryId || user.MyDocumentsDirectoryId)
	);
	return { ok: true, authToken: token, myDocsId: rootId };
}

async function ensureDiskAuth(state, params, options) {
	const opts = options && typeof options === 'object' ? options : {};
	const deferMyDocuments = opts.deferMyDocuments === true;
	const skillStorage = resolveSkillStorage(state);
	const env = readDiskEnv(state, params || {}, skillStorage);
	const userEnv = readUserEnv(state);
	if (!env.baseUrl) {
		return { ok: false, error: 'Не задан R7_DISK_BASE_URL.' };
	}
	let authToken = pickString(params && params.auth_token);
	if (!authToken && skillStorage) {
		authToken = pickString(skillStorage.get(STORAGE_KEY_AUTH_TOKEN));
	}
	let myDocsId = skillStorage ? parsePositiveId(skillStorage.get(STORAGE_KEY_MY_DOCS)) : null;
	if (!authToken) {
		if (!env.login || !env.password) {
			return {
				ok: false,
				error: 'Нет auth_token и не заданы R7_DISK_LOGIN/R7_DISK_PASSWORD в настройках установки навыка.',
				agent_message:
					'Не удалось авторизоваться на Р7 Диск: проверьте R7_DISK_BASE_URL, R7_DISK_LOGIN и R7_DISK_PASSWORD в настройках установки навыка. Не запрашивайте эти параметры у пользователя в чате.'
			};
		}
		const auth = await login(env.baseUrl, env.login, env.password);
		if (!auth.ok) return auth;
		authToken = auth.authToken;
		if (auth.myDocsId != null) {
			const verified = await verifyPersonalRootDirectory(env.baseUrl, authToken, auth.myDocsId);
			if (verified != null) myDocsId = verified;
		}
		if (skillStorage) {
			skillStorage.set(STORAGE_KEY_AUTH_TOKEN, authToken);
			skillStorage.set(STORAGE_KEY_BASE_URL, env.baseUrl);
			if (myDocsId != null) skillStorage.set(STORAGE_KEY_MY_DOCS, String(myDocsId));
		}
	}
	if (deferMyDocuments) {
		return {
			ok: true,
			baseUrl: env.baseUrl,
			authToken: authToken,
			myDocumentsDirectoryId: myDocsId,
			skillStorage: skillStorage
		};
	}
	if (myDocsId != null && authToken) {
		const verifiedCached = await verifyPersonalRootDirectory(env.baseUrl, authToken, myDocsId);
		if (verifiedCached == null) myDocsId = null;
	}

	const hostDocumentId = parsePositiveId(params && params.document_id);
	if (hostDocumentId != null) {
		const fromHost = await resolveMyDocumentsRootFromHostDocument(
			env.baseUrl,
			authToken,
			hostDocumentId
		);
		if (fromHost != null && fromHost.directory_id != null) {
			myDocsId = fromHost.directory_id;
			if (skillStorage) skillStorage.set(STORAGE_KEY_MY_DOCS, String(myDocsId));
		}
	}

	if (myDocsId == null) {
		const fromProfile = await resolveMyDocumentsRoot(
			env.baseUrl,
			authToken,
			userEnv,
			skillStorage,
			hostDocumentId
		);
		if (!fromProfile.ok) return fromProfile;
		myDocsId = fromProfile.directory_id;
		if (skillStorage && myDocsId != null) {
			skillStorage.set(STORAGE_KEY_MY_DOCS, String(myDocsId));
		}
	}
	return {
		ok: true,
		baseUrl: env.baseUrl,
		authToken: authToken,
		myDocumentsDirectoryId: myDocsId,
		skillStorage: skillStorage
	};
}

function pickPersonalRootFromAccessibleRoots(skillStorage) {
	if (!skillStorage) return null;
	const raw = skillStorage.get(STORAGE_KEY_ACCESSIBLE_ROOTS);
	if (typeof raw !== 'string' || !raw.trim()) return null;
	try {
		const roots = JSON.parse(raw);
		if (!Array.isArray(roots)) return null;
		for (const item of roots) {
			if (!item || typeof item !== 'object') continue;
			const name = pickString(item.name);
			const id = parsePositiveId(item.id);
			if (id != null && /мои\s*документ|my\s*documents/i.test(name)) return id;
		}
		for (const item of roots) {
			if (!item || typeof item !== 'object') continue;
			const id = parsePositiveId(item.id);
			const parentId = item.parent_id;
			const isTop = item.is_top_level === true || parentId == null || parentId === 0;
			const name = pickString(item.name);
			if (id != null && isTop && /мои\s*документ|my\s*documents/i.test(name)) return id;
		}
	} catch {
		return null;
	}
	return null;
}

function buildBrowseScanIds(maxId) {
	const rawLimit = typeof maxId === 'number' && Number.isFinite(maxId) ? maxId : BROWSE_SCAN_MAX_ID;
	const limit = Math.max(32, Math.min(Math.floor(rawLimit), BROWSE_SCAN_MAX_ID));
	const ids = [];
	for (let i = 2; i <= Math.min(128, limit); i += 1) ids.push(i);
	for (let i = 129; i <= limit; i += 1) ids.push(i);
	return ids;
}

function chunkBrowseIds(ids, size) {
	const out = [];
	const chunkSize =
		typeof size === 'number' && Number.isFinite(size) && size > 0 ? Math.floor(size) : 12;
	for (let i = 0; i < ids.length; i += chunkSize) out.push(ids.slice(i, i + chunkSize));
	return out;
}

function readParentDirectoryId(entry) {
	if (!entry || typeof entry !== 'object') return null;
	const parent = entry.Parent && typeof entry.Parent === 'object' ? entry.Parent : null;
	if (parent && typeof parent.Id === 'number') return parent.Id;
	if (typeof entry.ParentId === 'number') return entry.ParentId;
	return null;
}

function looksLikeMyDocumentsRoot(entry, name) {
	const title = String(name || '').trim();
	const parentId = readParentDirectoryId(entry || {});
	if (parentId == null || parentId === 0) {
		return !/^(общ|common|shared|корзин|избран|ладкрафт|recycle|favorites?|recent|file\s*depot)/i.test(
			title
		);
	}
	return /мои\s*документ|my\s*documents|^documents$/i.test(title);
}

async function resolvePersonalRootQuick(baseUrl, authToken, userEnv, skillStorage) {
	const fromRoots = pickPersonalRootFromAccessibleRoots(skillStorage);
	if (fromRoots != null) return { personalRootId: fromRoots };

	for (const candidateId of [1, 0]) {
		const fetched = await fetchDirectoryEntry(baseUrl, authToken, candidateId);
		if (!fetched.ok || !fetched.entry) continue;
		const entry = fetched.entry;
		const entryId = typeof entry.Id === 'number' ? entry.Id : candidateId;
		const name = pickString(entry.Name, entry.Title);
		if (looksLikeMyDocumentsRoot(entry, name)) return { personalRootId: entryId };
	}

	let fallback = null;
	for (const batch of chunkBrowseIds(buildBrowseScanIds(), BROWSE_SCAN_BATCH_SIZE)) {
		const fetched = await Promise.all(
			batch.map(async function (id) {
				return { id: id, fetched: await fetchDirectoryEntry(baseUrl, authToken, id) };
			})
		);
		for (let i = 0; i < fetched.length; i += 1) {
			const item = fetched[i];
			if (!item.fetched.ok || !item.fetched.entry) continue;
			const entry = item.fetched.entry;
			const name = pickString(entry.Name, entry.Title);
			const entryId = typeof entry.Id === 'number' ? entry.Id : item.id;
			if (/мои\s*документ|my\s*documents/i.test(name)) {
				return { personalRootId: entryId };
			}
			if (fallback == null && looksLikeMyDocumentsRoot(entry, name)) {
				fallback = { id: entryId };
			}
		}
		if (fallback != null) break;
	}
	if (fallback != null) return { personalRootId: fallback.id };

	const defaultParent =
		userEnv && typeof userEnv === 'object'
			? parsePositiveId(userEnv.R7_DISK_DEFAULT_PARENT_DIRECTORY_ID)
			: null;
	if (defaultParent != null) return { personalRootId: defaultParent };
	return { personalRootId: null };
}

async function resolveMyDocumentsRoot(baseUrl, authToken, userEnv, skillStorage, hostDocumentId) {
	const hostId = parsePositiveId(hostDocumentId);
	if (hostId != null) {
		const fromHost = await resolveMyDocumentsRootFromHostDocument(baseUrl, authToken, hostId);
		if (fromHost != null) {
			if (skillStorage) skillStorage.set(STORAGE_KEY_MY_DOCS, String(fromHost.directory_id));
			return fromHost;
		}
	}

	const profileUrl = `${baseUrl}/api/v1/People/GetProfile`;
	try {
		const response = await fetch(profileUrl, {
			method: 'GET',
			headers: { Authorization: authToken, 'Content-Type': 'application/json' }
		});
		const payload = await safeJson(response);
		if (response.ok) {
			const data = unwrapApiData(payload);
			const id = parsePositiveId(
				data &&
					(data.DocumentsDirectoryId ||
						data.documentsDirectoryId ||
						data.MyDocumentsDirectoryId ||
						data.myDocumentsDirectoryId)
			);
			if (id != null) {
				const verified = await verifyPersonalRootDirectory(baseUrl, authToken, id);
				if (verified != null) {
					return { ok: true, directory_id: verified, source: 'profile' };
				}
			}
		}
	} catch {}
	const quick = await resolvePersonalRootQuick(baseUrl, authToken, userEnv || {}, skillStorage || null);
	if (quick.personalRootId != null) {
		return { ok: true, directory_id: quick.personalRootId, source: 'quick_scan' };
	}
	return { ok: false, error: 'Не удалось определить корневую папку "Мои документы".' };
}

async function verifyPersonalRootDirectory(baseUrl, authToken, directoryId) {
	const id = parsePositiveId(directoryId);
	if (id == null) return null;
	const fetched = await fetchDirectoryEntry(baseUrl, authToken, id);
	if (!fetched.ok || !fetched.entry) return null;
	const name = pickString(fetched.entry.Name, fetched.entry.Title);
	if (MY_DOCS_NAME_RE.test(name) || looksLikeMyDocumentsRoot(fetched.entry, name)) return id;
	return null;
}

function folderNamesMatch(a, b) {
	return String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();
}

async function discoverReportFolderByScan(baseUrl, authToken, folderName, maxId) {
	const target = String(folderName || '').trim();
	if (!target) return null;
	const limit = typeof maxId === 'number' && maxId > 0 ? maxId : REPORT_FOLDER_SCAN_MAX_ID;
	let fallback = null;
	for (let id = 2; id <= limit; id += 1) {
		const fetched = await fetchDirectoryEntry(baseUrl, authToken, id);
		if (!fetched.ok || !fetched.entry) continue;
		const name = pickString(fetched.entry.Name, fetched.entry.Title);
		if (!folderNamesMatch(name, target)) continue;
		const entryId = typeof fetched.entry.Id === 'number' ? fetched.entry.Id : id;
		const parentId = readParentDirectoryId(fetched.entry);
		if (parentId != null && parentId > 0) {
			const parentFetched = await fetchDirectoryEntry(baseUrl, authToken, parentId);
			const parentName =
				parentFetched.ok && parentFetched.entry
					? pickString(parentFetched.entry.Name, parentFetched.entry.Title)
					: '';
			if (MY_DOCS_NAME_RE.test(parentName)) {
				return {
					directory_id: entryId,
					directory_name: name,
					my_documents_directory_id: parentId,
					source: 'report_folder_name_scan'
				};
			}
		}
		if (fallback == null) {
			fallback = {
				directory_id: entryId,
				directory_name: name,
				my_documents_directory_id: parentId,
				source: 'report_folder_name_scan_fallback'
			};
		}
	}
	return fallback;
}

async function fetchDocumentIdByNameInDirectory(baseUrl, authToken, directoryId, name) {
	const dirId = parsePositiveId(directoryId);
	const fileName = pickString(name);
	if (dirId == null || !fileName) return null;
	const url =
		`${baseUrl}/api/v1/Documents/GetIdByName?` +
		`name=${encodeURIComponent(fileName)}&directoryId=${encodeURIComponent(String(dirId))}`;
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
	const payload = await safeJson(response);
	const records = collectDocumentRecords(payload);
	for (let i = 0; i < records.length; i += 1) {
		const docId = parsePositiveId(records[i] && records[i].Id);
		if (docId != null) return docId;
	}
	const data = unwrapApiData(payload);
	const direct = parsePositiveId(data && (data.Id || data.id || data.DocumentId));
	return direct;
}

async function resolveDocumentInReportFolder(baseUrl, authToken, documentId, fileName, reportFolderName) {
	const contextId = parsePositiveId(documentId);
	const csvName = pickString(fileName);
	if (!csvName) return null;
	const discovered = await discoverReportFolderByScan(
		baseUrl,
		authToken,
		reportFolderName,
		REPORT_FOLDER_SCAN_MAX_ID
	);
	if (discovered == null || discovered.directory_id == null) return null;
	const foundId = await fetchDocumentIdByNameInDirectory(
		baseUrl,
		authToken,
		discovered.directory_id,
		csvName
	);
	if (foundId == null) return null;
	const idRemapped = contextId != null && foundId !== contextId;
	return {
		directory_id: discovered.directory_id,
		file_name: csvName,
		document_id: foundId,
		csv_document_id: foundId,
		context_document_id: contextId,
		id_remapped: idRemapped,
		my_documents_directory_id: discovered.my_documents_directory_id,
		source: idRemapped ? 'report_folder_name_reupload' : 'report_folder_get_id_by_name'
	};
}

function collectDocumentRecords(payload) {
	const records = [];
	if (payload == null) return records;
	if (Array.isArray(payload)) {
		for (let i = 0; i < payload.length; i += 1) {
			if (payload[i] && typeof payload[i] === 'object') records.push(payload[i]);
		}
		return records;
	}
	const data = unwrapApiData(payload);
	if (Array.isArray(data)) {
		for (let i = 0; i < data.length; i += 1) {
			if (data[i] && typeof data[i] === 'object') records.push(data[i]);
		}
		return records;
	}
	if (data && typeof data === 'object') records.push(data);
	return records;
}

function readDocumentDirectoryId(record) {
	if (!record || typeof record !== 'object') return null;
	return (
		parsePositiveId(record.DirectoryId) ||
		parsePositiveId(record.directoryId) ||
		parsePositiveId(record.directory_id) ||
		parsePositiveId(record.FolderId) ||
		parsePositiveId(record.folderId)
	);
}

function readDocumentName(record) {
	if (!record || typeof record !== 'object') return '';
	const name =
		typeof record.Name === 'string'
			? record.Name
			: typeof record.name === 'string'
				? record.name
				: typeof record.FileName === 'string'
					? record.FileName
					: '';
	return name.trim();
}

async function fetchDocumentRecordById(baseUrl, authToken, documentId) {
	const url = `${baseUrl}/api/v1/Documents/Get?id=${encodeURIComponent(String(documentId))}`;
	let response;
	try {
		response = await fetch(url, {
			method: 'GET',
			headers: { 'Content-Type': 'application/json', Authorization: authToken }
		});
	} catch (err) {
		return {
			ok: false,
			error: `Сетевая ошибка Documents/Get: ${String(err && err.message ? err.message : err)}`
		};
	}
	if (!response.ok) {
		return { ok: false, error: `Documents/Get HTTP ${response.status}` };
	}
	const rawText = await response.text();
	let payload = {};
	try {
		payload = rawText ? JSON.parse(rawText) : {};
	} catch {
		return { ok: false, error: 'Documents/Get: ответ не JSON.' };
	}
	const records = collectDocumentRecords(payload);
	for (let i = 0; i < records.length; i += 1) {
		const dirId = readDocumentDirectoryId(records[i]);
		const fileName = readDocumentName(records[i]);
		if (dirId != null || fileName) {
			return {
				ok: true,
				directory_id: dirId,
				document_record: records[i],
				file_name: fileName
			};
		}
	}
	return { ok: false, error: 'DirectoryId не найден в Documents/Get.' };
}

function isCsvFileName(fileName, fileExtension) {
	const name = String(fileName || '').trim().toLowerCase();
	if (!name) return false;
	const suffix = String(fileExtension || '.csv').toLowerCase();
	const normalized = suffix.startsWith('.') ? suffix : `.${suffix}`;
	return name.endsWith(normalized);
}

function normalizeAllDocuments(entry) {
	const data = pickDirectoryEntry(entry);
	if (!data || typeof data !== 'object') return [];
	const documents = Array.isArray(data.Documents) ? data.Documents : [];
	return documents
		.map(function (doc) {
			const name = pickString(doc && doc.Name);
			const id = parsePositiveId(doc && doc.Id);
			if (!name || id == null) return null;
			return {
				name: name,
				document_id: id,
				directory_id: parsePositiveId(doc && doc.DirectoryId)
			};
		})
		.filter(Boolean);
}

async function climbToPersonalRoot(baseUrl, authToken, startId) {
	const chain = [];
	let currentId = startId;
	const visited = new Set();
	while (currentId > 0 && !visited.has(currentId)) {
		visited.add(currentId);
		const fetched = await fetchDirectoryEntry(baseUrl, authToken, currentId);
		if (!fetched.ok || !fetched.entry) break;
		const entry = fetched.entry;
		const entryId = typeof entry.Id === 'number' ? entry.Id : currentId;
		const name = pickString(entry.Name, entry.Title) || `id=${entryId}`;
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

async function findDocumentInTree(baseUrl, authToken, rootIds, documentId, maxDepth) {
	const targetId = parsePositiveId(documentId);
	if (targetId == null) return null;
	const depthLimit = typeof maxDepth === 'number' && maxDepth > 0 ? maxDepth : 8;
	const startIds = [];
	if (Array.isArray(rootIds)) {
		for (let i = 0; i < rootIds.length; i += 1) {
			const id = parsePositiveId(rootIds[i]);
			if (id != null) startIds.push(id);
		}
	} else {
		const id = parsePositiveId(rootIds);
		if (id != null) startIds.push(id);
	}
	if (startIds.length === 0) {
		for (const scanId of buildBrowseScanIds(200)) startIds.push(scanId);
	}
	const visited = new Set();
	const queue = startIds.map(function (id) {
		return { id: id, depth: 0 };
	});
	while (queue.length > 0) {
		const current = queue.shift();
		if (!current || visited.has(current.id)) continue;
		visited.add(current.id);
		const fetched = await fetchDirectoryEntry(baseUrl, authToken, current.id);
		if (!fetched.ok || !fetched.entry) continue;
		const docs = normalizeAllDocuments(fetched.entry);
		for (let i = 0; i < docs.length; i += 1) {
			if (docs[i].document_id === targetId) {
				return {
					directory_id: current.id,
					file_name: docs[i].name,
					document_id: targetId
				};
			}
		}
		if (current.depth + 1 < depthLimit) {
			const children = normalizeFolderList(fetched.entry);
			for (let j = 0; j < children.length; j += 1) {
				queue.push({ id: children[j].directory_id, depth: current.depth + 1 });
			}
		}
	}
	return null;
}

async function resolveMyDocumentsRootFromHostDocument(baseUrl, authToken, hostDocumentId) {
	const found = await findDocumentInTree(baseUrl, authToken, [], hostDocumentId, 8);
	if (found == null || found.directory_id == null) return null;
	const climbed = await climbToPersonalRoot(baseUrl, authToken, found.directory_id);
	if (climbed.personal_root_id == null) return null;
	return {
		ok: true,
		directory_id: climbed.personal_root_id,
		source: 'host_document_climb',
		host_directory_id: found.directory_id
	};
}

function readSectionRootsFromStorage(skillStorage) {
	if (!skillStorage) return {};
	const raw = skillStorage.get(STORAGE_KEY_SECTION_ROOTS);
	if (typeof raw !== 'string' || !raw.trim()) return {};
	try {
		const parsed = JSON.parse(raw);
		if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
	} catch {}
	return {};
}

function looksLikeVirtualSectionDirectoryName(dirName) {
	return /^(доступно\s*для\s*меня|совместн|общ|избран|корзин|последн|хранилищ)/i.test(
		String(dirName || '').trim()
	);
}

async function fetchSharedSectionDocuments(baseUrl, authToken, skillStorage) {
	const roots = readSectionRootsFromStorage(skillStorage);
	const sharedRootId = parsePositiveId(roots.shared_to_me);
	const probeIds = sharedRootId != null ? [sharedRootId] : [62, 63];
	for (let i = 0; i < probeIds.length; i += 1) {
		const id = probeIds[i];
		const fetched = await fetchDirectoryEntry(baseUrl, authToken, id);
		if (!fetched.ok || !fetched.entry) continue;
		const dirName = pickString(fetched.entry.Name, fetched.entry.Title);
		const docs = normalizeAllDocuments(fetched.entry);
		if (docs.length > 0 || looksLikeVirtualSectionDirectoryName(dirName)) return docs;
	}
	return [];
}

async function findDocumentInSharedListing(baseUrl, authToken, skillStorage, documentId) {
	const targetId = parsePositiveId(documentId);
	if (targetId == null) return null;
	const sharedDocs = await fetchSharedSectionDocuments(baseUrl, authToken, skillStorage);
	for (let i = 0; i < sharedDocs.length; i += 1) {
		const doc = sharedDocs[i];
		if (doc.document_id !== targetId) continue;
		return {
			document_id: targetId,
			file_name: doc.name,
			owner_directory_id: doc.directory_id,
			is_shared_document: true
		};
	}
	return null;
}

async function resolveHostDocumentContext(baseUrl, authToken, skillStorage, params) {
	const documentId = parsePositiveId(params && params.document_id);
	const fileNameFromContext = pickString(params && params.file_name);
	if (documentId == null) {
		return {
			ok: false,
			error: 'Не задан document_id текущего документа.',
			agent_message: 'Откройте документ через плагин R7 — не удалось определить document_id.'
		};
	}

	let hostDirectoryId = null;
	let resolvedName = fileNameFromContext;
	let resolvedVia = 'explicit_id';
	let isShared = false;
	let ownerDirectoryId = null;
	let personalRootId = null;

	const record = await fetchDocumentRecordById(baseUrl, authToken, documentId);
	if (record.ok) {
		hostDirectoryId = record.directory_id;
		resolvedName = pickString(fileNameFromContext, record.file_name);
		resolvedVia = 'documents_get';
	}

	if (hostDirectoryId == null) {
		const found = await findDocumentInTree(baseUrl, authToken, [], documentId, 8);
		if (found != null) {
			hostDirectoryId = found.directory_id;
			resolvedName = pickString(fileNameFromContext, found.file_name);
			resolvedVia = 'tree_scan';
		}
	}

	if (hostDirectoryId == null) {
		const sharedMatch = await findDocumentInSharedListing(
			baseUrl,
			authToken,
			skillStorage,
			documentId
		);
		if (sharedMatch != null) {
			isShared = true;
			resolvedName = pickString(fileNameFromContext, sharedMatch.file_name);
			ownerDirectoryId = sharedMatch.owner_directory_id;
			resolvedVia = 'shared_listing';
		}
	}

	if (hostDirectoryId != null && !isShared) {
		const climbed = await climbToPersonalRoot(baseUrl, authToken, hostDirectoryId);
		personalRootId = climbed.personal_root_id;
		if (personalRootId != null && skillStorage) {
			skillStorage.set(STORAGE_KEY_MY_DOCS, String(personalRootId));
		}
	}

	return {
		ok: true,
		document_id: documentId,
		file_name: resolvedName || fileNameFromContext,
		host_directory_id: hostDirectoryId,
		is_shared: isShared,
		owner_directory_id: ownerDirectoryId,
		personal_root_id: personalRootId,
		resolved_via: resolvedVia
	};
}

async function resolveCurrentDocumentSource(auth, documentId, fileName, fileExtension, reportFolderName) {
	const id = parsePositiveId(documentId);
	if (id == null) {
		return {
			ok: false,
			error: 'Не задан document_id текущего документа.',
			agent_message: 'Откройте документ через плагин R7 — не удалось определить document_id.'
		};
	}
	const nameFromContext = pickString(fileName);
	if (nameFromContext && !isCsvFileName(nameFromContext, fileExtension)) {
		return {
			ok: true,
			current_file_is_csv: false,
			fallback_to_other_files: true,
			document_id: id,
			file_name: nameFromContext,
			source: 'current_document_not_csv',
			do_not_invent_content: true,
			agent_message: `«${nameFromContext}» не является CSV. Покажу другие файлы для отчёта.`
		};
	}

	const host = await resolveHostDocumentContext(auth.baseUrl, auth.authToken, auth.skillStorage, {
		document_id: id,
		file_name: nameFromContext
	});
	if (!host.ok) {
		if (!auth.baseUrl || !auth.authToken) {
			return {
				ok: false,
				error: host.error || 'Не удалось проверить текущий документ на Р7 Диске.',
				agent_message:
					'Не заданы R7_DISK_* на установленной копии навыка. Проверьте настройки или выполните sync-after-reconnect / publish-skill.'
			};
		}
		if (nameFromContext && isCsvFileName(nameFromContext, fileExtension)) {
			const reportFolderLabel = pickString(reportFolderName) || 'Таблицы для отчета';
			const viaReportFolder = await resolveDocumentInReportFolder(
				auth.baseUrl,
				auth.authToken,
				id,
				nameFromContext,
				reportFolderLabel
			);
			if (viaReportFolder != null) {
				return buildCurrentCsvResult({
					documentId: viaReportFolder.document_id,
					contextDocumentId: id,
					resolvedName: nameFromContext,
					directoryId: viaReportFolder.directory_id,
					isShared: false,
					needsPersonalUpload: false,
					resolvedVia: viaReportFolder.source || 'report_folder_get_id_by_name'
				});
			}
			return {
				ok: false,
				error: `Документ id=${id} не найден, CSV «${nameFromContext}» отсутствует в «${reportFolderLabel}».`,
				agent_message:
					`Не удалось найти «${nameFromContext}» на диске (id ${id} устарел). Обновите контекст в плагине или выберите «Показать другие файлы».`
			};
		}
		return host;
	}

	let resolvedDocId = id;
	let directoryId = host.is_shared ? null : host.host_directory_id;
	let resolvedName = pickString(nameFromContext, host.file_name);
	const isShared = host.is_shared === true;
	let needsPersonalUpload = isShared || directoryId == null;
	let resolvedVia = host.resolved_via || 'current_document';

	const reportFolderLabel = pickString(reportFolderName) || 'Таблицы для отчета';
	const shouldResolveByName =
		!isShared &&
		nameFromContext &&
		isCsvFileName(nameFromContext, fileExtension) &&
		(directoryId == null || host.resolved_via === 'explicit_id');

	if (shouldResolveByName) {
		const viaReportFolder = await resolveDocumentInReportFolder(
			auth.baseUrl,
			auth.authToken,
			id,
			nameFromContext,
			reportFolderLabel
		);
		if (viaReportFolder != null) {
			resolvedDocId = viaReportFolder.document_id;
			directoryId = viaReportFolder.directory_id;
			resolvedName = pickString(nameFromContext, viaReportFolder.file_name);
			needsPersonalUpload = false;
			resolvedVia = viaReportFolder.source || 'report_folder_get_id_by_name';
			if (viaReportFolder.my_documents_directory_id != null && auth.skillStorage) {
				auth.myDocumentsDirectoryId = viaReportFolder.my_documents_directory_id;
				auth.skillStorage.set(
					STORAGE_KEY_MY_DOCS,
					String(viaReportFolder.my_documents_directory_id)
				);
			}
		} else if (host.resolved_via === 'explicit_id') {
			return {
				ok: false,
				error: `Документ id=${id} не найден на Р7 Диске, а CSV «${nameFromContext}» не найден в папке «${reportFolderLabel}».`,
				agent_message:
					`Файл «${nameFromContext}» не найден по id ${id} (возможно, переустановка или повторная загрузка). ` +
					'Откройте файл с диска и обновите контекст в плагине, или выберите «Показать другие файлы».'
			};
		}
	}

	if (!resolvedName && !nameFromContext) {
		return {
			ok: false,
			error: 'Не удалось определить имя текущего документа.',
			agent_message: 'Не удалось получить имя текущего документа с Р7 Диска.'
		};
	}
	if (!resolvedName) resolvedName = nameFromContext;

	const isCsv = isCsvFileName(resolvedName, fileExtension);
	if (!isCsv) {
		return {
			ok: true,
			current_file_is_csv: false,
			fallback_to_other_files: true,
			document_id: id,
			file_name: resolvedName || null,
			directory_id: directoryId,
			source: 'current_document_not_csv',
			do_not_invent_content: true,
			agent_message: resolvedName
				? `«${resolvedName}» не является CSV. Покажу другие файлы для отчёта.`
				: 'Текущий документ не является CSV. Покажу другие файлы для отчёта.'
		};
	}

	return buildCurrentCsvResult({
		documentId: resolvedDocId,
		contextDocumentId: resolvedDocId !== id ? id : null,
		resolvedName: resolvedName,
		directoryId: directoryId,
		isShared: isShared,
		needsPersonalUpload: needsPersonalUpload,
		resolvedVia: resolvedVia
	});
}

function buildCurrentCsvResult(options) {
	const documentId = options.documentId;
	const contextDocumentId = options.contextDocumentId;
	const resolvedName = options.resolvedName;
	const directoryId = options.directoryId;
	const isShared = options.isShared === true;
	const needsPersonalUpload = options.needsPersonalUpload === true || isShared;
	const resolvedVia = options.resolvedVia || 'current_document';
	const fileEntry = {
		name: resolvedName,
		document_id: documentId,
		csv_document_id: documentId
	};
	if (directoryId != null) fileEntry.directory_id = directoryId;

	let agentMessage = `Текущий документ «${resolvedName}» — CSV. Формирую отчёт.`;
	if (contextDocumentId != null && contextDocumentId !== documentId) {
		agentMessage =
			`Текущий документ «${resolvedName}» — CSV (id обновлён с ${contextDocumentId} на ${documentId} по имени в папке). Формирую отчёт.`;
	} else if (isShared) {
		agentMessage =
			`Текущий документ «${resolvedName}» — расшаренный CSV. ` +
			'Отчёт будет сохранён в «Мои документы».';
	} else if (needsPersonalUpload) {
		agentMessage =
			`Текущий документ «${resolvedName}» — CSV. ` +
			'Папка на диске не определена — отчёт будет сохранён в «Мои документы».';
	}

	const result = {
		ok: true,
		current_file_is_csv: true,
		document_id: documentId,
		csv_document_id: documentId,
		csv_name: resolvedName,
		file_name: resolvedName,
		is_shared: isShared,
		needs_personal_upload: needsPersonalUpload,
		files: [fileEntry],
		folders: [],
		folder_found: true,
		source: resolvedVia,
		do_not_invent_content: true,
		cite_only_fields: ['files', 'csv_name', 'directory_id', 'csv_document_id', 'is_shared'],
		agent_message: agentMessage
	};
	if (directoryId != null) result.directory_id = directoryId;
	if (contextDocumentId != null && contextDocumentId !== documentId) {
		result.context_document_id = contextDocumentId;
		result.id_remapped = true;
	}
	return result;
}

async function findFolderByNameInsensitive(baseUrl, authToken, rootId, folderName, maxDepth) {
	const target = String(folderName || '').trim().toLowerCase();
	if (!target) return null;
	const depthLimit = typeof maxDepth === 'number' && maxDepth > 0 ? maxDepth : 4;
	const queue = [{ id: rootId, depth: 0 }];
	const visited = new Set();
	while (queue.length > 0) {
		const current = queue.shift();
		if (!current || visited.has(current.id)) continue;
		visited.add(current.id);
		const fetched = await fetchDirectoryEntry(baseUrl, authToken, current.id);
		if (!fetched.ok || !fetched.entry) continue;
		const children = normalizeFolderList(fetched.entry);
		for (let i = 0; i < children.length; i += 1) {
			const child = children[i];
			if (String(child.name || '').trim().toLowerCase() === target) return child.directory_id;
			if (current.depth + 1 < depthLimit) {
				queue.push({ id: child.directory_id, depth: current.depth + 1 });
			}
		}
	}
	const scanned = await discoverReportFolderByScan(
		baseUrl,
		authToken,
		folderName,
		REPORT_FOLDER_SCAN_MAX_ID
	);
	if (scanned != null) return scanned.directory_id;
	return null;
}
