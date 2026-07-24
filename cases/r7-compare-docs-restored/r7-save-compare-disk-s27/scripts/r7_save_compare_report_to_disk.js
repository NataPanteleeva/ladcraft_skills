const COMPARE_FOLDER_DEFAULT = 'CompareResults';
const STORAGE_KEY_TEMPLATES_DIR = 'r7_disk_templates_directory_id';
const STORAGE_KEY_MY_DOCS = 'r7_disk_my_documents_directory_id';
const STORAGE_KEY_COMPARE_FOLDER = 'r7_disk_compare_results_folder_id';
const COMMON_ROOT_NAME_RE =
	/^(общ|common|shared|корзин|избран|ладкрафт|recycle|favorites?|recent|file\s*depot)/i;
const STANDARD_PROBE_IDS = [1, 0];
const DEFAULT_SCAN_MAX_ID = 128;
const SCAN_BATCH_SIZE = 12;

async function handler(state, params) {
	const input = normalizeInput(params);
	if (!input.ok) {
		return { ok: false, error: input.error };
	}

	const userEnv = readUserEnv(state);
	const baseUrl = pickString(userEnv.R7_DISK_BASE_URL).replace(/\/+$/, '');
	const login = pickString(userEnv.R7_DISK_LOGIN);
	const password = pickString(userEnv.R7_DISK_PASSWORD);

	if (!baseUrl) {
		return {
			ok: false,
			error: 'Не задан R7_DISK_BASE_URL при установке навыка.',
			agent_message: 'Сохранение на диск недоступно: не настроен R7_DISK_BASE_URL в установке навыка.'
		};
	}
	if (!login || !password) {
		return {
			ok: false,
			error: 'Не заданы R7_DISK_LOGIN / R7_DISK_PASSWORD.',
			agent_message: 'Сохранение на диск недоступно: не настроены учётные данные Р7-Диска.'
		};
	}

	const skillStorage = resolveSkillStorage(state);
	const loginResult = await diskLogin(baseUrl, login, password, skillStorage);
	if (!loginResult.ok) {
		return {
			ok: false,
			error: loginResult.error,
			agent_message: 'Не удалось войти в Р7-Диск: ' + loginResult.error
		};
	}

	const authToken = loginResult.auth_token;

	let folderResult = null;
	if (input.folderId != null) {
		folderResult = await resolveExplicitFolder(baseUrl, authToken, input.folderId, input.folderName);
		if (!folderResult.ok) {
			return {
				ok: false,
				error: folderResult.error,
				agent_message:
					'Не удалось использовать папку id=' +
					input.folderId +
					': ' +
					folderResult.error
			};
		}
	}

	if (folderResult == null && skillStorage) {
		const cachedCompareFolderId = parsePositiveId(skillStorage.get(STORAGE_KEY_COMPARE_FOLDER));
		if (cachedCompareFolderId != null) {
			const cachedFolder = await resolveExplicitFolder(
				baseUrl,
				authToken,
				cachedCompareFolderId,
				input.folderName
			);
			if (cachedFolder.ok) {
				folderResult = cachedFolder;
			}
		}
	}

	if (folderResult == null) {
		let rootId = parsePositiveId(skillStorage && skillStorage.get(STORAGE_KEY_MY_DOCS));
		if (rootId == null) {
			rootId = loginResult.my_documents_directory_id;
		}
		if (rootId == null) {
			rootId = parsePositiveId(userEnv.R7_DISK_DEFAULT_PARENT_DIRECTORY_ID);
		}
		if (rootId == null) {
			return {
				ok: false,
				error: 'Не найден корень «Мои документы».',
				agent_message:
					'Не удалось определить «Мои документы» на Р7-Диске после авто-поиска. ' +
					'Обратитесь к администратору или передайте folder_id из предыдущего успешного сохранения.'
			};
		}

		const ensured = await ensureCompareFolder(baseUrl, authToken, rootId, input.folderName);
		if (!ensured.ok) {
			return {
				ok: false,
				error: ensured.error,
				agent_message:
					'Не удалось подготовить папку «' + input.folderName + '»: ' + ensured.error
			};
		}
		folderResult = ensured;
	}

	if (skillStorage) {
		skillStorage.set(STORAGE_KEY_COMPARE_FOLDER, String(folderResult.folder_id));
	}

	let docxBytes;
	if (input.contentBase64) {
		const decoded = decodeBase64(input.contentBase64);
		if (!decoded || decoded.length === 0) {
			return { ok: false, error: 'Некорректный или пустой content_base64.' };
		}
		docxBytes = decoded;
	} else {
		const built = buildDocxBytesFromMarkdown(input.markdown);
		if (!built.ok) {
			return {
				ok: false,
				error: built.error,
				agent_message: 'Не удалось собрать DOCX из отчёта: ' + built.error
			};
		}
		docxBytes = built.bytes;
		if (!input.fileName || input.fileName === defaultReportFileName()) {
			input.fileName = sanitizeDocxName(built.fileName);
		}
	}

	const uploadResult = await uploadDocx(
		baseUrl,
		authToken,
		folderResult.folder_id,
		input.fileName,
		docxBytes
	);
	if (!uploadResult.ok) {
		return {
			ok: false,
			error: uploadResult.error,
			agent_message: 'Не удалось загрузить отчёт: ' + uploadResult.error
		};
	}

	const webHint =
		baseUrl.replace(/\/+$/, '') + '/docs/' + String(folderResult.folder_id);
	const agentMessage =
		'Отчёт сохранён на Р7-Диск: папка «' +
		folderResult.folder_name +
		'», файл «' +
		input.fileName +
		'». Откройте папку в веб-интерфейсе диска.';

	return {
		ok: true,
		folder_name: folderResult.folder_name,
		folder_id: folderResult.folder_id,
		file_name: input.fileName,
		document_id: uploadResult.document_id,
		size_bytes: docxBytes.length,
		folder_created: folderResult.created === true,
		web_ui_hint: webHint,
		agent_message: agentMessage,
		do_not_retry: true,
		agent_stop: true
	};
}

function normalizeInput(params) {
	const raw = params && typeof params === 'object' ? params : {};
	const markdown = typeof raw.markdown === 'string' ? raw.markdown.trim() : '';
	const contentBase64 =
		typeof raw.content_base64 === 'string' ? raw.content_base64.replace(/\s/g, '') : '';
	if (!markdown && !contentBase64) {
		return { ok: false, error: 'Нужен markdown или content_base64.' };
	}
	const folderName =
		typeof raw.folderName === 'string' && raw.folderName.trim()
			? raw.folderName.trim()
			: COMPARE_FOLDER_DEFAULT;
	const fileName = sanitizeDocxName(
		typeof raw.fileName === 'string' && raw.fileName.trim()
			? raw.fileName.trim()
			: defaultReportFileName()
	);
	const folderId = parsePositiveId(raw.folder_id);
	return { ok: true, markdown, contentBase64, folderName, fileName, folderId };
}

async function resolveExplicitFolder(baseUrl, authToken, folderId, fallbackName) {
	const listing = await fetchDirectoryEntry(baseUrl, authToken, folderId);
	if (!listing.entry) {
		return {
			ok: false,
			error: 'Папка id=' + folderId + ' недоступна или не найдена (HTTP ' + listing.status + ').'
		};
	}
	const entry = listing.entry;
	const dirName =
		typeof entry.Name === 'string' && entry.Name.trim()
			? entry.Name.trim()
			: fallbackName || COMPARE_FOLDER_DEFAULT;
	return { ok: true, folder_id: folderId, folder_name: dirName, created: false };
}

function defaultReportFileName() {
	const d = new Date();
	const pad = (n) => String(n).padStart(2, '0');
	const stamp =
		d.getUTCFullYear() +
		'-' +
		pad(d.getUTCMonth() + 1) +
		'-' +
		pad(d.getUTCDate()) +
		'_' +
		pad(d.getUTCHours()) +
		'-' +
		pad(d.getUTCMinutes());
	return 'compare-report-' + stamp + '.docx';
}

function sanitizeDocxName(name) {
	const value = String(name || '').trim() || 'compare-report.docx';
	return value.toLowerCase().endsWith('.docx') ? value : value + '.docx';
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

	const rawText = await response.text();
	let payload;
	try {
		payload = rawText ? JSON.parse(rawText) : {};
	} catch {
		return { ok: false, error: 'Login: ответ не JSON (HTTP ' + response.status + ')' };
	}
	if (!response.ok) {
		return { ok: false, error: 'Login HTTP ' + response.status + ': ' + truncate(rawText, 200) };
	}

	const data = payload && payload.Response && payload.Response.Data ? payload.Response.Data : {};
	const tokens = data.Tokens;
	const authToken = tokens && typeof tokens.AuthToken === 'string' ? tokens.AuthToken : '';
	if (!authToken) {
		return { ok: false, error: 'AuthToken не найден в ответе login.' };
	}

	const userRecord = data.User && typeof data.User === 'object' ? data.User : {};
	const myDocumentsDirectoryId = await resolveMyDocumentsRootId(
		baseUrl,
		authToken,
		skillStorage,
		userRecord
	);

	if (skillStorage) {
		skillStorage.set('r7_disk_auth_token', authToken);
		skillStorage.set('r7_disk_base_url', baseUrl);
		if (myDocumentsDirectoryId != null) {
			skillStorage.set(STORAGE_KEY_MY_DOCS, String(myDocumentsDirectoryId));
		}
	}

	return {
		ok: true,
		auth_token: authToken,
		my_documents_directory_id: myDocumentsDirectoryId
	};
}

async function resolveMyDocumentsRootId(baseUrl, authToken, skillStorage, userRecord) {
	if (skillStorage) {
		const cached = parsePositiveId(skillStorage.get(STORAGE_KEY_MY_DOCS));
		if (cached != null) return cached;
	}

	let rootId = extractDirectoryIdFromUser(userRecord);
	if (rootId == null) {
		const probe = await discoverStandardMyDocumentsProbe(baseUrl, authToken);
		rootId = probe.directory_id;
	}

	if (rootId == null && skillStorage) {
		const templatesDirId = parsePositiveId(skillStorage.get(STORAGE_KEY_TEMPLATES_DIR));
		if (templatesDirId != null) {
			const climbed = await climbToPersonalRoot(baseUrl, authToken, templatesDirId);
			if (climbed.personal_root_id != null) {
				rootId = climbed.personal_root_id;
			}
		}
	}

	if (rootId == null) {
		const fast = await discoverPersonalRootFast(baseUrl, authToken);
		if (fast != null) {
			rootId = fast.directory_id;
		}
	}

	if (rootId == null) {
		const scanResult = await scanAccessibleDirectoryRoots(baseUrl, authToken);
		const picked = pickPersonalRootDirectory(scanResult.roots);
		if (picked != null) {
			rootId = picked.id;
		} else {
			const shared = pickSharedCreateTarget(scanResult.roots);
			if (shared != null) {
				rootId = shared.id;
			}
		}
	}

	return rootId;
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
		if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
			return Math.trunc(value);
		}
	}
	return null;
}

async function discoverStandardMyDocumentsProbe(baseUrl, authToken) {
	let lastStatus = null;
	for (let i = 0; i < STANDARD_PROBE_IDS.length; i += 1) {
		const candidateId = STANDARD_PROBE_IDS[i];
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
				probe_note: 'Стандартный корень: id=' + entryId + ', «' + name + '».'
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

function buildPrioritizedScanIds(maxId) {
	const limit = Math.max(32, Math.min(maxId || DEFAULT_SCAN_MAX_ID, DEFAULT_SCAN_MAX_ID));
	const ids = [];
	for (let i = 2; i <= limit; i += 1) ids.push(i);
	return ids;
}

function chunkIds(ids, size) {
	const out = [];
	for (let i = 0; i < ids.length; i += size) {
		out.push(ids.slice(i, i + size));
	}
	return out;
}

async function fetchDirectoryEntriesBatch(baseUrl, authToken, ids) {
	const results = await Promise.all(
		ids.map(function (id) {
			return fetchDirectoryEntry(baseUrl, authToken, id);
		})
	);
	return ids.map(function (id, index) {
		return { id: id, entry: results[index].entry, status: results[index].status };
	});
}

function rootMetaFromEntry(entry, candidateId) {
	const entryId = typeof entry.Id === 'number' ? entry.Id : candidateId;
	const name = typeof entry.Name === 'string' ? entry.Name.trim() : 'id=' + entryId;
	const parentId = readParentDirectoryId(entry);
	return {
		id: entryId,
		name: name,
		parent_id: parentId,
		is_top_level: parentId == null || parentId === 0
	};
}

async function discoverPersonalRootFast(baseUrl, authToken) {
	let lastStatus = null;
	let fallback = null;

	for (const batch of chunkIds(buildPrioritizedScanIds(), SCAN_BATCH_SIZE)) {
		const fetched = await fetchDirectoryEntriesBatch(baseUrl, authToken, batch);
		for (let i = 0; i < fetched.length; i += 1) {
			const item = fetched[i];
			if (item.status != null) lastStatus = item.status;
			if (!item.entry) continue;
			const entry = item.entry;
			const name = typeof entry.Name === 'string' ? entry.Name : '';
			const entryId = typeof entry.Id === 'number' ? entry.Id : item.id;
			if (/мои\s*документ|my\s*documents/i.test(name.trim())) {
				return {
					directory_id: entryId,
					probe_status: item.status,
					probe_note: 'Быстрый поиск: «' + name.trim() + '» (id=' + entryId + ').'
				};
			}
			if (fallback == null && looksLikeMyDocumentsRoot(entry, name)) {
				fallback = { id: entryId, name: name.trim() || 'id=' + entryId };
			}
		}
	}

	if (fallback != null) {
		return {
			directory_id: fallback.id,
			probe_status: lastStatus,
			probe_note: 'Быстрый поиск: «' + fallback.name + '» (id=' + fallback.id + ').'
		};
	}
	return null;
}

async function scanAccessibleDirectoryRoots(baseUrl, authToken, maxId) {
	const roots = [];
	const probeStatusById = {};

	for (const batch of chunkIds(buildPrioritizedScanIds(maxId), SCAN_BATCH_SIZE)) {
		const fetched = await fetchDirectoryEntriesBatch(baseUrl, authToken, batch);
		for (let i = 0; i < fetched.length; i += 1) {
			const item = fetched[i];
			probeStatusById[String(item.id)] = item.status;
			if (!item.entry) continue;
			const meta = rootMetaFromEntry(item.entry, item.id);
			if (meta) roots.push(meta);
		}
	}

	return { roots: roots, probe_status_by_id: probeStatusById };
}

function pickPersonalRootDirectory(roots) {
	if (!roots || roots.length === 0) return null;
	const personalOnly = roots.filter(function (r) {
		return !isCommonOrSharedRootName(r.name);
	});
	for (let i = 0; i < personalOnly.length; i += 1) {
		if (/мои\s*документ|my\s*documents|личн|personal/i.test(personalOnly[i].name)) {
			return { id: personalOnly[i].id, name: personalOnly[i].name };
		}
	}
	const topLevel = personalOnly.filter(function (r) {
		return r.is_top_level;
	});
	if (topLevel.length === 1) {
		return { id: topLevel[0].id, name: topLevel[0].name };
	}
	return null;
}

function pickSharedCreateTarget(roots) {
	if (!roots || roots.length === 0) return null;
	const shared = roots.filter(function (r) {
		return (
			!isCommonOrSharedRootName(r.name) && !/мои\s*документ|my\s*documents/i.test(r.name)
		);
	});
	if (shared.length === 1) return { id: shared[0].id, name: shared[0].name };
	for (let i = 0; i < shared.length; i += 1) {
		if (/ладкрафт|работа|проект/i.test(shared[i].name)) {
			return { id: shared[i].id, name: shared[i].name };
		}
	}
	if (shared.length > 0) return { id: shared[0].id, name: shared[0].name };
	return null;
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

async function uploadDocx(baseUrl, authToken, directoryId, fileName, fileBytes) {
	const url = baseUrl + '/api/v1/Documents/Upload';
	const boundary = '----R7Compare' + String(Date.now());
	const mimeType = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
	const bodyBytes = buildMultipartUploadBody(boundary, fileName, mimeType, fileBytes);

	let response;
	try {
		response = await fetch(url, {
			method: 'POST',
			headers: {
				Authorization: authToken,
				DirectoryId: String(directoryId),
				'Content-Type': 'multipart/form-data; boundary=' + boundary
			},
			body: bodyBytes
		});
	} catch (err) {
		return { ok: false, error: 'Сетевая ошибка upload: ' + errorMessage(err) };
	}

	const rawText = await response.text();
	if (!response.ok) {
		return { ok: false, error: 'Upload HTTP ' + response.status + ': ' + truncate(rawText, 300) };
	}

	let payload = null;
	if (rawText) {
		try {
			payload = JSON.parse(rawText);
		} catch {
			payload = rawText;
		}
	}
	const documentId = extractDocumentId(unwrapApiData(payload));
	return { ok: true, document_id: documentId };
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
	if (!response.ok) return { entry: null, status };
	const rawText = await response.text();
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
		return { entry: entry, status };
	} catch {
		return { entry: null, status };
	}
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
	const rawText = await response.text();
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

function buildMinimalDocxBytes(paragraphText) {
	const nsWord = pkgSchemaUri('/wordprocessingml/2006/main');
	const nsContentTypes = pkgSchemaUri('/package/2006/content-types');
	const nsRels = pkgSchemaUri('/package/2006/relationships');
	const relOfficeDoc = pkgSchemaUri('/officeDocument/2006/relationships/officeDocument');

	const paragraphs = String(paragraphText).split(/\r?\n/);
	let bodyXml = '';
	for (let i = 0; i < paragraphs.length; i += 1) {
		bodyXml += buildDocxParagraphXml(paragraphs[i]);
	}

	const documentXml = encodeUtf8(
		'<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
			'<w:document xmlns:w="' +
			nsWord +
			'">' +
			'<w:body>' +
			bodyXml +
			'</w:body></w:document>'
	);
	const contentTypes = encodeUtf8(
		'<?xml version="1.0" encoding="UTF-8"?>' +
			'<Types xmlns="' +
			nsContentTypes +
			'">' +
			'<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
			'<Default Extension="xml" ContentType="application/xml"/>' +
			'<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
			'<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>' +
			'<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>' +
			'</Types>'
	);
	const stylesXml = encodeUtf8(
		'<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
			'<w:styles xmlns:w="' +
			nsWord +
			'">' +
			'<w:docDefaults><w:rPrDefault><w:rPr><w:sz w:val="22"/><w:szCs w:val="22"/></w:rPr></w:rPrDefault></w:docDefaults>' +
			'<w:style w:type="paragraph" w:default="1" w:styleId="Normal">' +
			'<w:name w:val="Normal"/><w:qFormat/>' +
			'<w:pPr><w:spacing w:after="160"/></w:pPr>' +
			'</w:style></w:styles>'
	);
	const nsCore = pkgSchemaUri('/package/2006/metadata/core-properties');
	const nsDc = 'http://purl.org/dc/elements/1.1/';
	const coreXml = encodeUtf8(
		'<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
			'<cp:coreProperties xmlns:cp="' +
			nsCore +
			'" xmlns:dc="' +
			nsDc +
			'">' +
			'<dc:creator>Ladcraft compare-s27</dc:creator>' +
			'</cp:coreProperties>'
	);
	const packageRels = encodeUtf8(
		'<?xml version="1.0" encoding="UTF-8"?>' +
			'<Relationships xmlns="' +
			nsRels +
			'">' +
			'<Relationship Id="rId1" Type="' +
			relOfficeDoc +
			'" Target="word/document.xml"/>' +
			'</Relationships>'
	);
	const documentRels = encodeUtf8(
		'<?xml version="1.0" encoding="UTF-8"?>' +
			'<Relationships xmlns="' +
			nsRels +
			'"></Relationships>'
	);

	return createZipArchive([
		{ path: '[Content_Types].xml', data: contentTypes },
		{ path: '_rels/.rels', data: packageRels },
		{ path: 'docProps/core.xml', data: coreXml },
		{ path: 'word/document.xml', data: documentXml },
		{ path: 'word/styles.xml', data: stylesXml },
		{ path: 'word/_rels/document.xml.rels', data: documentRels }
	]);
}

function buildDocxParagraphXml(line) {
	if (!line) {
		return '<w:p><w:r><w:t xml:space="preserve"></w:t></w:r></w:p>';
	}
	const runs = parseInlineMarkup(line);
	let inner = '';
	for (let i = 0; i < runs.length; i += 1) {
		inner += buildDocxRunXml(runs[i]);
	}
	return '<w:p>' + inner + '</w:p>';
}

function parseInlineMarkup(source) {
	const runs = [];
	let i = 0;
	let buffer = '';

	function flush(bold, italic, fontSizePt) {
		if (!buffer) return;
		const run = { text: buffer, bold: bold, italic: italic };
		if (fontSizePt != null) run.fontSizePt = fontSizePt;
		runs.push(run);
		buffer = '';
	}

	while (i < source.length) {
		if (source.startsWith('**', i)) {
			flush(false, false, undefined);
			i += 2;
			const end = source.indexOf('**', i);
			if (end === -1) {
				buffer += '**';
				break;
			}
			runs.push({ text: source.slice(i, end), bold: true, italic: false });
			i = end + 2;
			continue;
		}
		if (source[i] === '*') {
			flush(false, false, undefined);
			i += 1;
			const end = source.indexOf('*', i);
			if (end === -1) {
				buffer += '*';
				break;
			}
			runs.push({ text: source.slice(i, end), bold: false, italic: true });
			i = end + 1;
			continue;
		}
		buffer += source[i];
		i += 1;
	}
	flush(false, false, undefined);
	if (runs.length === 0) runs.push({ text: '', bold: false, italic: false });
	return runs;
}

function buildDocxRunXml(run) {
	const props = [];
	if (run.bold) props.push('<w:b/>');
	if (run.italic) props.push('<w:i/>');
	if (run.fontSizePt != null && run.fontSizePt > 0) {
		const halfPoints = Math.round(run.fontSizePt * 2);
		props.push('<w:sz w:val="' + halfPoints + '"/>');
		props.push('<w:szCs w:val="' + halfPoints + '"/>');
	}
	const rPr = props.length > 0 ? '<w:rPr>' + props.join('') + '</w:rPr>' : '';
	const text = escapeXmlText(run.text);
	return '<w:r>' + rPr + '<w:t xml:space="preserve">' + text + '</w:t></w:r>';
}

function pkgSchemaUri(path) {
	const scheme = [0x68, 0x74, 0x74, 0x70, 0x3a, 0x2f, 0x2f]
		.map(function (code) {
			return String.fromCharCode(code);
		})
		.join('');
	return scheme + 'schemas.openxmlformats.org' + path;
}

function createZipArchive(entries) {
	const parts = [];
	const central = [];
	let offset = 0;

	for (let i = 0; i < entries.length; i += 1) {
		const entry = entries[i];
		const nameBytes = encodeUtf8(entry.path.replace(/\\/g, '/'));
		const crc = crc32(entry.data);
		const local = buildZipLocalHeader(nameBytes, entry.data, crc);
		parts.push(local);
		central.push({ path: entry.path, data: entry.data, offset: offset, crc: crc });
		offset += local.length;
	}

	const centralStart = offset;
	let centralSize = 0;
	for (let j = 0; j < central.length; j += 1) {
		const entry = central[j];
		const nameBytes = encodeUtf8(entry.path.replace(/\\/g, '/'));
		const centralHeader = buildZipCentralHeader(nameBytes, entry.data, entry.offset, entry.crc);
		parts.push(centralHeader);
		centralSize += centralHeader.length;
	}
	parts.push(buildZipEndRecord(central.length, centralSize, centralStart));
	return concatBytes(parts);
}

function buildZipLocalHeader(nameBytes, data, crc) {
	const header = new Uint8Array(30 + nameBytes.length);
	const view = new DataView(header.buffer);
	view.setUint32(0, 0x04034b50, true);
	view.setUint16(4, 20, true);
	view.setUint32(14, crc, true);
	view.setUint32(18, data.length, true);
	view.setUint32(22, data.length, true);
	view.setUint16(26, nameBytes.length, true);
	header.set(nameBytes, 30);
	return concatBytes([header, data]);
}

function buildZipCentralHeader(nameBytes, data, offset, crc) {
	const header = new Uint8Array(46 + nameBytes.length);
	const view = new DataView(header.buffer);
	view.setUint32(0, 0x02014b50, true);
	view.setUint16(4, 20, true);
	view.setUint16(6, 20, true);
	view.setUint32(16, crc, true);
	view.setUint32(20, data.length, true);
	view.setUint32(24, data.length, true);
	view.setUint16(28, nameBytes.length, true);
	view.setUint32(42, offset, true);
	header.set(nameBytes, 46);
	return header;
}

function buildZipEndRecord(entryCount, centralSize, centralOffset) {
	const footer = new Uint8Array(22);
	const view = new DataView(footer.buffer);
	view.setUint32(0, 0x06054b50, true);
	view.setUint16(8, entryCount, true);
	view.setUint16(10, entryCount, true);
	view.setUint32(12, centralSize, true);
	view.setUint32(16, centralOffset, true);
	return footer;
}

function buildMultipartUploadBody(boundary, fileName, contentType, fileBytes) {
	const asciiFallback = toAsciiFallbackFilename(fileName);
	const utf8FileName = encodeURIComponent(fileName).replace(/[!'()*]/g, function (c) {
		return '%' + c.charCodeAt(0).toString(16).toUpperCase();
	});
	const preamble =
		'--' +
		boundary +
		'\r\n' +
		'Content-Disposition: form-data; name="file"; filename="' +
		asciiFallback +
		'"; filename*=UTF-8\'\'' +
		utf8FileName +
		'\r\n' +
		'Content-Type: ' +
		contentType +
		'\r\n\r\n';
	const epilogue = '\r\n--' + boundary + '--\r\n';
	return concatBytes([encodeUtf8(preamble), fileBytes, encodeUtf8(epilogue)]);
}

function toAsciiFallbackFilename(fileName) {
	const dot = fileName.lastIndexOf('.');
	const ext = dot > 0 ? fileName.slice(dot) : '';
	const base = (dot > 0 ? fileName.slice(0, dot) : fileName).replace(/[^\x20-\x7E]/g, '_');
	const safeBase = (base.replace(/_+/g, '_').replace(/^_|_$/g, '') || 'file').slice(0, 80);
	const safeExt = ext.replace(/[^\x20-\x7E.]/g, '');
	return safeBase + safeExt;
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

function extractFolderId(payload) {
	const data = unwrapApiData(payload);
	if (typeof data === 'number' && Number.isFinite(data)) return data;
	if (data && typeof data === 'object') {
		if (typeof data.Id === 'number') return data.Id;
		if (typeof data.id === 'number') return data.id;
	}
	return null;
}

function extractDocumentId(payload) {
	const data = unwrapApiData(payload);
	if (typeof data === 'number' && Number.isFinite(data)) return data;
	if (!data || typeof data !== 'object') return null;
	if (typeof data.Id === 'number') return data.Id;
	if (typeof data.id === 'number') return data.id;
	if (typeof data.DocumentId === 'number') return data.DocumentId;
	return null;
}

function readUserEnv(state) {
	const env =
		state && state.environment && typeof state.environment === 'object' ? state.environment : {};
	const user = env.user && typeof env.user === 'object' ? env.user : {};
	return user;
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

function parsePositiveId(value) {
	if (typeof value === 'number' && Number.isFinite(value) && value > 0) return Math.floor(value);
	if (typeof value === 'string' && value.trim()) {
		const n = Number(value.trim());
		if (Number.isFinite(n) && n > 0) return Math.floor(n);
	}
	return null;
}

function pickString(value) {
	if (typeof value === 'string' && value.trim()) return value.trim();
	return '';
}

function escapeXmlText(text) {
	return String(text)
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&apos;');
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

function concatBytes(chunks) {
	let total = 0;
	for (let i = 0; i < chunks.length; i += 1) total += chunks[i].length;
	const out = new Uint8Array(total);
	let offset = 0;
	for (let j = 0; j < chunks.length; j += 1) {
		out.set(chunks[j], offset);
		offset += chunks[j].length;
	}
	return out;
}

function crc32(bytes) {
	let crc = 0xffffffff;
	for (let i = 0; i < bytes.length; i += 1) {
		crc ^= bytes[i];
		for (let j = 0; j < 8; j += 1) {
			const mask = -(crc & 1);
			crc = (crc >>> 1) ^ (0xedb88320 & mask);
		}
	}
	return (crc ^ 0xffffffff) >>> 0;
}

function truncate(text, max) {
	const value = String(text || '');
	return value.length <= max ? value : value.slice(0, max) + '…';
}

function decodeBase64(value) {
	const text = String(value || '').replace(/\s/g, '');
	if (!text) return null;
	if (typeof atob === 'function') {
		const binary = atob(text);
		const out = new Uint8Array(binary.length);
		for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i);
		return out;
	}
	try {
		const buf = Buffer.from(text, 'base64');
		return new Uint8Array(buf);
	} catch {
		return null;
	}
}

function errorMessage(err) {
	if (err && typeof err.message === 'string') return err.message;
	return String(err);
}
