const STORAGE_KEY_AUTH_TOKEN = 'r7_disk_auth_token';
const STORAGE_KEY_BASE_URL = 'r7_disk_base_url';
const STORAGE_KEY_MY_DOCS = 'r7_disk_my_documents_directory_id';
const STORAGE_KEY_ACCESSIBLE_ROOTS = 'r7_disk_accessible_roots';
const BROWSE_SCAN_BATCH_SIZE = 12;
const BROWSE_SCAN_MAX_ID = 256;

function asObject(value) {
	if (value && typeof value === 'object') return value;
	return null;
}

function pickString() {
	for (let i = 0; i < arguments.length; i += 1) {
		const value = arguments[i];
		if (typeof value === 'string' && value.trim()) return value.trim();
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
	const baseUrl = pickString(
		params && params.base_url,
		skillStorage && skillStorage.get(STORAGE_KEY_BASE_URL),
		userEnv.R7_DISK_BASE_URL
	).replace(/\/+$/, '');
	return {
		baseUrl: baseUrl,
		login: pickString(params && params.login, userEnv.R7_DISK_LOGIN),
		password: pickString(params && params.password, userEnv.R7_DISK_PASSWORD)
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

async function ensureDiskAuth(state, params) {
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
			return { ok: false, error: 'Нет auth_token и не заданы R7_DISK_LOGIN/R7_DISK_PASSWORD.' };
		}
		const auth = await login(env.baseUrl, env.login, env.password);
		if (!auth.ok) return auth;
		authToken = auth.authToken;
		if (auth.myDocsId != null) myDocsId = auth.myDocsId;
		if (skillStorage) {
			skillStorage.set(STORAGE_KEY_AUTH_TOKEN, authToken);
			skillStorage.set(STORAGE_KEY_BASE_URL, env.baseUrl);
			if (myDocsId != null) skillStorage.set(STORAGE_KEY_MY_DOCS, String(myDocsId));
		}
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
			if (id != null) return { ok: true, directory_id: id, source: 'profile' };
		}
	} catch {}
	const quick = await resolvePersonalRootQuick(baseUrl, authToken, userEnv || {}, skillStorage || null);
	if (quick.personalRootId != null) {
		return { ok: true, directory_id: quick.personalRootId, source: 'quick_scan' };
	}
	return { ok: false, error: 'Не удалось определить корневую папку "Мои документы".' };
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

async function resolveCurrentDocumentSource(auth, documentId, fileName, fileExtension) {
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

	let directoryId = null;
	let resolvedName = nameFromContext;
	const record = await fetchDocumentRecordById(auth.baseUrl, auth.authToken, id);
	if (record.ok) {
		directoryId = record.directory_id;
		resolvedName = pickString(nameFromContext, record.file_name);
	} else {
		let found = await findDocumentInTree(
			auth.baseUrl,
			auth.authToken,
			[auth.myDocumentsDirectoryId],
			id,
			8
		);
		if (found == null) {
			found = await findDocumentInTree(auth.baseUrl, auth.authToken, [], id, 8);
		}
		if (found != null) {
			directoryId = found.directory_id;
			resolvedName = pickString(nameFromContext, found.file_name);
		} else if (!nameFromContext) {
			return {
				ok: false,
				error: record.error || 'Не удалось получить документ с диска.',
				agent_message: record.error || 'Не удалось получить текущий документ с Р7 Диска.'
			};
		}
	}
	if (directoryId == null) {
		return {
			ok: false,
			error: 'DirectoryId не найден для текущего документа.',
			agent_message: 'Не удалось определить папку текущего документа на Р7 Диске.'
		};
	}
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
	return {
		ok: true,
		current_file_is_csv: true,
		document_id: id,
		directory_id: directoryId,
		csv_name: resolvedName,
		file_name: resolvedName,
		files: [
			{
				name: resolvedName,
				document_id: id,
				directory_id: directoryId
			}
		],
		folders: [],
		folder_found: true,
		source: 'current_document',
		do_not_invent_content: true,
		cite_only_fields: ['files', 'csv_name', 'directory_id'],
		agent_message: `Текущий документ «${resolvedName}» — CSV. Формирую отчёт.`
	};
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
	return null;
}
