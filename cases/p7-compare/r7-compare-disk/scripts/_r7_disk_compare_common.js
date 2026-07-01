const COMPARE_FOLDER_DEFAULT = 'CompareResults';
const TEMPLATES_FOLDER_NAME = 'templates';
const TEMPLATE_MAX_BYTES = 150000;
const DOCUMENT_MAX_BYTES = 200000;
const COMMON_ROOT_NAME_RE =
	/^(общ|common|shared|корзин|избран|ладкрафт|recycle|favorites?|recent|file\s*depot)/i;

const STORAGE_KEY_TEMPLATES_DIR = 'r7_disk_templates_directory_id';
const STORAGE_KEY_TEMPLATE_DOC_IDS = 'r7_disk_template_document_ids';
const STORAGE_KEY_MY_DOCS = 'r7_disk_my_documents_directory_id';
const STORAGE_KEY_COMPARE_FOLDER = 'r7_disk_compare_results_folder_id';
const STORAGE_KEY_HOST_DOC_PREFIX = 'r7_disk_host_doc:';

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

function validateDiskBaseUrl(baseUrl) {
	if (!baseUrl) {
		return { ok: false, error: 'R7_DISK_BASE_URL не задан.' };
	}
	if (baseUrl.includes('@') && !/^https?:\/\//i.test(baseUrl)) {
		return {
			ok: false,
			error:
				'R7_DISK_BASE_URL похож на email («' +
				baseUrl +
				'»), а нужен URL API диска, например https://cddisk.gptz.lad-soft.ru',
			agent_message:
				'Неверная настройка навыка: в R7_DISK_BASE_URL указан email. Укажите URL Р7-Диска (https://cddisk…), логин — в R7_DISK_LOGIN.'
		};
	}
	if (!/^https?:\/\//i.test(baseUrl)) {
		return {
			ok: false,
			error: 'R7_DISK_BASE_URL должен начинаться с http:// или https:// (сейчас: «' + baseUrl + '»)',
			agent_message:
				'Неверный R7_DISK_BASE_URL. Пример: https://cddisk.gptz.lad-soft.ru — без слэша в конце.'
		};
	}
	return { ok: true };
}

function missingDiskEnvError(missing) {
	return {
		ok: false,
		error: 'Не заданы параметры Р7-Диска: ' + missing.join(', '),
		agent_message:
			'Сравнение через диск недоступно: настройте ' + missing.join(', ') + ' при установке навыка.'
	};
}

const TEMPLATES_SCAN_MAX_ID = 180;
const MY_DOCS_NAME_RE = /мои\s*документ|my\s*documents/i;

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

async function discoverPersonalRootByScan(baseUrl, authToken, maxId) {
	const limit = typeof maxId === 'number' && maxId > 0 ? maxId : 160;
	for (let id = 2; id <= limit; id += 1) {
		const fetched = await fetchDirectoryEntry(baseUrl, authToken, id);
		if (!fetched.entry) continue;
		const name = typeof fetched.entry.Name === 'string' ? fetched.entry.Name.trim() : '';
		if (!MY_DOCS_NAME_RE.test(name)) continue;
		const entryId = typeof fetched.entry.Id === 'number' ? fetched.entry.Id : id;
		return { ok: true, directory_id: entryId, source: 'name_scan' };
	}
	return { ok: false, error: 'Корень «Мои документы» не найден сканированием.' };
}

async function discoverTemplatesFolderByScan(baseUrl, authToken, maxId) {
	const limit = typeof maxId === 'number' && maxId > 0 ? maxId : TEMPLATES_SCAN_MAX_ID;
	let fallback = null;
	for (let id = 2; id <= limit; id += 1) {
		const fetched = await fetchDirectoryEntry(baseUrl, authToken, id);
		if (!fetched.entry) continue;
		const name = typeof fetched.entry.Name === 'string' ? fetched.entry.Name.trim() : '';
		if (!folderNamesMatch(name, TEMPLATES_FOLDER_NAME)) continue;
		const entryId = typeof fetched.entry.Id === 'number' ? fetched.entry.Id : id;
		const parentId = readParentDirectoryId(fetched.entry);
		if (parentId != null && parentId > 0) {
			const parentFetched = await fetchDirectoryEntry(baseUrl, authToken, parentId);
			const parentName =
				parentFetched.entry && typeof parentFetched.entry.Name === 'string'
					? parentFetched.entry.Name.trim()
					: '';
			if (MY_DOCS_NAME_RE.test(parentName)) {
				return {
					templates_id: entryId,
					my_documents_directory_id: parentId,
					source: 'templates_name_scan'
				};
			}
		}
		if (fallback == null) {
			fallback = {
				templates_id: entryId,
				my_documents_directory_id: parentId,
				source: 'templates_name_scan_fallback'
			};
		}
	}
	return fallback;
}

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

function readTemplateDocumentIds(skillStorage) {
	if (!skillStorage) return [];
	const raw = skillStorage.get(STORAGE_KEY_TEMPLATE_DOC_IDS);
	if (!raw) return [];
	try {
		const parsed = JSON.parse(raw);
		if (!Array.isArray(parsed)) return [];
		const ids = [];
		for (let i = 0; i < parsed.length; i += 1) {
			const id = parsePositiveId(parsed[i]);
			if (id != null) ids.push(id);
		}
		return ids;
	} catch {
		return [];
	}
}

function saveTemplateDocumentIds(skillStorage, templates) {
	if (!skillStorage || !Array.isArray(templates)) return;
	const ids = [];
	for (let i = 0; i < templates.length; i += 1) {
		const tpl = templates[i];
		const id = parsePositiveId(tpl && tpl.document_id);
		if (id != null) ids.push(id);
	}
	skillStorage.set(STORAGE_KEY_TEMPLATE_DOC_IDS, JSON.stringify(ids));
}

function isTemplateDocumentId(documentId, skillStorage) {
	const id = parsePositiveId(documentId);
	if (id == null) return false;
	const ids = readTemplateDocumentIds(skillStorage);
	for (let i = 0; i < ids.length; i += 1) {
		if (ids[i] === id) return true;
	}
	return false;
}

async function fetchDocumentRecordById(baseUrl, authToken, documentId) {
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
		const payload = rawText ? JSON.parse(rawText) : null;
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
	} catch {
		return { ok: false, error: 'Documents/Get: ответ не JSON.' };
	}
	return { ok: false, error: 'DirectoryId не найден в Documents/Get.' };
}

async function fetchDocumentDirectoryId(baseUrl, authToken, documentId) {
	const record = await fetchDocumentRecordById(baseUrl, authToken, documentId);
	if (!record.ok) return record;
	if (record.directory_id == null) {
		return { ok: false, error: 'DirectoryId не найден в Documents/Get.' };
	}
	return record;
}

async function validateExplicitHostId(baseUrl, authToken, explicitId, hostFileName, skillStorage) {
	if (isTemplateDocumentId(explicitId, skillStorage)) {
		return { ok: false, reason: 'template_id_collision' };
	}
	const record = await fetchDocumentRecordById(baseUrl, authToken, explicitId);
	if (!record.ok) {
		return { ok: false, reason: 'api_error', error: record.error };
	}
	const templatesDirId = skillStorage
		? parsePositiveId(skillStorage.get(STORAGE_KEY_TEMPLATES_DIR))
		: null;
	if (templatesDirId != null && record.directory_id === templatesDirId) {
		return {
			ok: false,
			reason: 'in_templates_folder',
			disk_name: record.file_name
		};
	}
	const normalizedHost = normalizeHostFileName(hostFileName);
	if (normalizedHost && record.file_name && !fileNamesMatchForLookup(record.file_name, normalizedHost)) {
		return {
			ok: false,
			reason: 'name_mismatch',
			disk_name: record.file_name
		};
	}
	return {
		ok: true,
		disk_name: record.file_name,
		directory_id: record.directory_id
	};
}

async function resolveMyDocumentsRootFromHostDocument(baseUrl, authToken, hostDocumentId) {
	const docDir = await fetchDocumentDirectoryId(baseUrl, authToken, hostDocumentId);
	if (!docDir.ok) return null;
	const climbed = await climbToPersonalRoot(baseUrl, authToken, docDir.directory_id);
	if (climbed.personal_root_id == null) return null;
	return {
		ok: true,
		directory_id: climbed.personal_root_id,
		source: 'host_document_climb',
		host_directory_id: docDir.directory_id
	};
}

async function findTemplatesFolderViaHostDocument(baseUrl, authToken, hostDocumentId) {
	const docDir = await fetchDocumentDirectoryId(baseUrl, authToken, hostDocumentId);
	if (!docDir.ok) return null;

	let currentId = docDir.directory_id;
	const visited = new Set();

	while (currentId > 0 && !visited.has(currentId)) {
		visited.add(currentId);
		const fetched = await fetchDirectoryEntry(baseUrl, authToken, currentId);
		if (!fetched.entry) break;

		const entryName = typeof fetched.entry.Name === 'string' ? fetched.entry.Name.trim() : '';
		if (looksLikeMyDocumentsRoot(fetched.entry, entryName)) {
			const templatesId = await findFolderByNameInsensitive(
				baseUrl,
				authToken,
				currentId,
				TEMPLATES_FOLDER_NAME,
				4
			);
			if (templatesId != null) {
				return {
					templates_id: templatesId,
					my_documents_directory_id: currentId,
					source: 'host_ancestor_root'
				};
			}
		}

		const parentId = readParentDirectoryId(fetched.entry);
		if (parentId != null && parentId > 0) {
			const parentFetched = await fetchDirectoryEntry(baseUrl, authToken, parentId);
			if (parentFetched.entry) {
				const children = Array.isArray(parentFetched.entry.Children)
					? parentFetched.entry.Children
					: [];
				for (let i = 0; i < children.length; i += 1) {
					const child = children[i];
					if (!child || typeof child !== 'object' || typeof child.Id !== 'number') continue;
					const childName = typeof child.Name === 'string' ? child.Name.trim() : '';
					if (folderNamesMatch(childName, TEMPLATES_FOLDER_NAME)) {
						return {
							templates_id: child.Id,
							my_documents_directory_id: parentId,
							source: 'host_sibling_walk'
						};
					}
				}
			}
		}

		if (parentId == null || parentId === 0) break;
		currentId = parentId;
	}
	return null;
}

async function resolveMyDocumentsRoot(baseUrl, authToken, options) {
	const skillStorage = options && options.skillStorage ? options.skillStorage : null;
	const hostDocumentId =
		options && options.hostDocumentId != null ? options.hostDocumentId : null;
	const loginUser = options && options.loginUser ? options.loginUser : null;

	// disk-ref: дерево открытого документа важнее id из профиля User после Login
	if (hostDocumentId != null) {
		const fromHost = await resolveMyDocumentsRootFromHostDocument(
			baseUrl,
			authToken,
			hostDocumentId
		);
		if (fromHost != null) {
			if (skillStorage) {
				skillStorage.set(STORAGE_KEY_MY_DOCS, String(fromHost.directory_id));
			}
			return fromHost;
		}
	}

	if (hostDocumentId == null && skillStorage) {
		const cached = parsePositiveId(skillStorage.get(STORAGE_KEY_MY_DOCS));
		if (cached != null) return { ok: true, directory_id: cached, source: 'cache' };
	}

	const fromUser = extractDirectoryIdFromUser(loginUser);
	if (fromUser != null) {
		if (hostDocumentId != null) {
			const templatesUnderUser = await findFolderByNameInsensitive(
				baseUrl,
				authToken,
				fromUser,
				TEMPLATES_FOLDER_NAME,
				4
			);
			if (templatesUnderUser == null) {
				const fromHostRetry = await resolveMyDocumentsRootFromHostDocument(
					baseUrl,
					authToken,
					hostDocumentId
				);
				if (fromHostRetry != null) {
					if (skillStorage) {
						skillStorage.set(STORAGE_KEY_MY_DOCS, String(fromHostRetry.directory_id));
					}
					return fromHostRetry;
				}
			}
		}
		if (skillStorage) skillStorage.set(STORAGE_KEY_MY_DOCS, String(fromUser));
		return { ok: true, directory_id: fromUser, source: 'login_user' };
	}

	if (hostDocumentId != null) {
		const fromHostLate = await resolveMyDocumentsRootFromHostDocument(
			baseUrl,
			authToken,
			hostDocumentId
		);
		if (fromHostLate != null) {
			if (skillStorage) {
				skillStorage.set(STORAGE_KEY_MY_DOCS, String(fromHostLate.directory_id));
			}
			return fromHostLate;
		}
	}

	const probed = await discoverPersonalRootByScan(baseUrl, authToken, TEMPLATES_SCAN_MAX_ID);
	if (probed.ok) {
		if (skillStorage) skillStorage.set(STORAGE_KEY_MY_DOCS, String(probed.directory_id));
		return { ok: true, directory_id: probed.directory_id, source: probed.source || 'name_scan' };
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

	const hostDocumentId =
		parsePositiveId(raw.host_document_id) ||
		parsePositiveId(raw.document_id) ||
		parsePositiveId(raw.resolved_host_document_id);

	if (hostDocumentId == null && skillStorage) {
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

	const myDocsResult = await resolveMyDocumentsRoot(auth.baseUrl, auth.authToken, {
		skillStorage: skillStorage,
		hostDocumentId: hostDocumentId,
		loginUser: auth.loginUser
	});
	if (!myDocsResult.ok) return myDocsResult;

	let templatesId = await findFolderByNameInsensitive(
		auth.baseUrl,
		auth.authToken,
		myDocsResult.directory_id,
		TEMPLATES_FOLDER_NAME,
		4
	);
	let templatesSource = 'my_documents_tree';

	if (templatesId == null && hostDocumentId != null) {
		const viaHost = await findTemplatesFolderViaHostDocument(
			auth.baseUrl,
			auth.authToken,
			hostDocumentId
		);
		if (viaHost != null) {
			templatesId = viaHost.templates_id;
			templatesSource = viaHost.source;
			if (skillStorage) {
				skillStorage.set(STORAGE_KEY_MY_DOCS, String(viaHost.my_documents_directory_id));
			}
			myDocsResult.directory_id = viaHost.my_documents_directory_id;
			myDocsResult.source = viaHost.source;
		}
	}

	if (templatesId == null) {
		const scanned = await discoverTemplatesFolderByScan(
			auth.baseUrl,
			auth.authToken,
			TEMPLATES_SCAN_MAX_ID
		);
		if (scanned != null && scanned.templates_id != null) {
			templatesId = scanned.templates_id;
			templatesSource = scanned.source;
			if (scanned.my_documents_directory_id != null) {
				myDocsResult.directory_id = scanned.my_documents_directory_id;
				myDocsResult.source = scanned.source;
				if (skillStorage) {
					skillStorage.set(STORAGE_KEY_MY_DOCS, String(scanned.my_documents_directory_id));
				}
			}
		}
	}

	if (templatesId == null) {
		let hostLookupError = null;
		if (hostDocumentId != null) {
			const docDir = await fetchDocumentDirectoryId(
				auth.baseUrl,
				auth.authToken,
				hostDocumentId
			);
			if (!docDir.ok) hostLookupError = docDir.error;
		}
		return {
			ok: false,
			error: 'Папка templates не найдена в «Мои документы».',
			agent_message:
				'Папка templates не найдена. Проверьте: в «Мои документы» есть папка templates (латиница), как в браузере Р7-Диска.',
			my_documents_directory_id: myDocsResult.directory_id,
			my_documents_source: myDocsResult.source,
			host_document_id: hostDocumentId,
			host_directory_lookup_error: hostLookupError
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
		my_documents_source: myDocsResult.source,
		templates_source: templatesSource,
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

	const urlCheck = validateDiskBaseUrl(env.baseUrl);
	if (!urlCheck.ok) {
		return {
			ok: false,
			error: urlCheck.error,
			agent_message: urlCheck.agent_message || urlCheck.error
		};
	}

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
	const normalized = String(name || '').trim();
	if (MY_DOCS_NAME_RE.test(normalized)) return true;
	return false;
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

function normalizeConfusableFileName(name) {
	return String(name || '')
		.trim()
		.toLowerCase()
		.replace(/\u0432/g, 'b')
		.replace(/\u0430/g, 'a')
		.replace(/\u0435/g, 'e')
		.replace(/\u043e/g, 'o')
		.replace(/\u0440/g, 'p')
		.replace(/\u0441/g, 'c')
		.replace(/\u0443/g, 'y')
		.replace(/\u0445/g, 'x')
		.replace(/\u0456/g, 'i');
}

function fileNamesMatchForLookup(actualName, requestedName) {
	const actual = actualName.trim().toLowerCase();
	const requested = requestedName.trim().toLowerCase();
	if (!requested) return false;
	if (actual === requested) return true;
	if (normalizeConfusableFileName(actual) === normalizeConfusableFileName(requested)) return true;
	if (!requested.includes('.')) {
		const dot = actual.lastIndexOf('.');
		const base = dot > 0 ? actual.slice(0, dot) : actual;
		if (base === requested) return true;
		if (actual.startsWith(requested + '.')) return true;
		const normBase = dot > 0 ? normalizeConfusableFileName(actual.slice(0, dot)) : normalizeConfusableFileName(actual);
		if (normBase === normalizeConfusableFileName(requested)) return true;
	}
	return false;
}

function pickNewestDocument(docs) {
	return docs.slice().sort(function (a, b) {
		const aId = typeof a.Id === 'number' ? a.Id : 0;
		const bId = typeof b.Id === 'number' ? b.Id : 0;
		return bId - aId;
	})[0];
}

async function findDocumentInDirectory(baseUrl, authToken, directoryId, requestedName) {
	const docs = await fetchDirectoryDocuments(baseUrl, authToken, directoryId);
	const exactMatches = [];
	const fuzzyMatches = [];
	for (let i = 0; i < docs.length; i += 1) {
		const doc = docs[i];
		const name = typeof doc.Name === 'string' ? doc.Name.trim() : '';
		if (!name) continue;
		const lower = name.toLowerCase();
		const reqLower = requestedName.trim().toLowerCase();
		if (lower === reqLower || (!reqLower.includes('.') && lower.startsWith(reqLower + '.'))) {
			exactMatches.push(doc);
		} else if (fileNamesMatchForLookup(name, requestedName)) {
			fuzzyMatches.push(doc);
		}
	}

	const matches = exactMatches.length > 0 ? exactMatches : fuzzyMatches;
	const matchedVia = exactMatches.length > 0 ? 'exact' : fuzzyMatches.length > 0 ? 'confusable' : '';

	if (matches.length === 0) {
		return {
			ok: false,
			error: 'Файл «' + requestedName + '» не найден в папке id=' + directoryId + '.'
		};
	}

	const uniqueNames = [];
	const seen = new Set();
	for (let i = 0; i < matches.length; i += 1) {
		const n = typeof matches[i].Name === 'string' ? matches[i].Name.trim() : '';
		if (n && !seen.has(n.toLowerCase())) {
			seen.add(n.toLowerCase());
			uniqueNames.push(n);
		}
	}
	if (uniqueNames.length > 1) {
		return {
			ok: false,
			error:
				'Имя «' +
				requestedName +
				'» неоднозначно в папке id=' +
				directoryId +
				': ' +
				uniqueNames.map(function (n) {
					return '«' + n + '»';
				}).join(', ')
		};
	}

	const picked = pickNewestDocument(matches);
	const documentId = typeof picked.Id === 'number' ? picked.Id : null;
	const fileName = typeof picked.Name === 'string' ? picked.Name.trim() : requestedName;
	if (documentId == null) {
		return { ok: false, error: 'Не удалось определить document_id файла.' };
	}
	return {
		ok: true,
		document_id: documentId,
		file_name: fileName,
		directory_id: directoryId,
		matched_via: matchedVia
	};
}

function normalizeHostFileName(name) {
	let value = pickString(name);
	if (!value) return '';
	if (!/\.(docx|md)$/i.test(value)) value += '.docx';
	return value;
}

function hostDocCacheKey(fileName) {
	return STORAGE_KEY_HOST_DOC_PREFIX + normalizeHostFileName(fileName).toLowerCase();
}

async function findDocumentByNameInTree(baseUrl, authToken, rootId, requestedName, maxDepth, options) {
	const normalized = normalizeHostFileName(requestedName);
	const depthLimit = typeof maxDepth === 'number' && maxDepth > 0 ? maxDepth : 8;
	const opts = options && typeof options === 'object' ? options : {};
	const excludeRaw = opts.excludeDirectoryIds;
	const excludeIds = new Set();
	if (excludeRaw instanceof Set) {
		excludeRaw.forEach(function (id) {
			if (id != null) excludeIds.add(id);
		});
	} else if (Array.isArray(excludeRaw)) {
		for (let i = 0; i < excludeRaw.length; i += 1) {
			if (excludeRaw[i] != null) excludeIds.add(excludeRaw[i]);
		}
	}
	const queue = [{ id: rootId, depth: 0 }];
	const visited = new Set();

	while (queue.length > 0) {
		const current = queue.shift();
		if (!current || visited.has(current.id)) continue;
		visited.add(current.id);

		if (!excludeIds.has(current.id)) {
			const inDir = await findDocumentInDirectory(
				baseUrl,
				authToken,
				current.id,
				normalized
			);
			if (inDir.ok) {
				return {
					ok: true,
					document_id: inDir.document_id,
					file_name: inDir.file_name,
					directory_id: inDir.directory_id,
					resolved_via:
						inDir.matched_via === 'confusable'
							? 'my_documents_tree_confusable'
							: 'my_documents_tree'
				};
			}
		}

		const fetched = await fetchDirectoryEntry(baseUrl, authToken, current.id);
		if (!fetched.entry) continue;
		const children = Array.isArray(fetched.entry.Children) ? fetched.entry.Children : [];
		for (let i = 0; i < children.length; i += 1) {
			const child = children[i];
			if (!child || typeof child !== 'object' || typeof child.Id !== 'number') continue;
			if (current.depth < depthLimit) {
				queue.push({ id: child.Id, depth: current.depth + 1 });
			}
		}
	}

	return {
		ok: false,
		error:
			'Документ «' +
			normalized +
			'» не найден в «Мои документы». Сохраните файл на Р7-Диск и повторите.',
		agent_message:
			'Не найден файл «' +
			normalized +
			'» на Р7-Диске. Проверьте: (1) файл сохранён в «Мои документы» (в т.ч. подпапки); (2) имя в редакторе совпадает с именем на диске — часто путают латинскую b и кириллическую в (например b3 vs в3).'
	};
}

async function findHostDocumentByName(auth, fileName, skillStorage, requestedDocumentId) {
	const myDocsResult = await resolveMyDocumentsRoot(auth.baseUrl, auth.authToken, {
		skillStorage: skillStorage,
		hostDocumentId: null,
		loginUser: auth.loginUser
	});
	if (!myDocsResult.ok) return myDocsResult;

	const excludeIds = [];
	const templatesDirId = skillStorage
		? parsePositiveId(skillStorage.get(STORAGE_KEY_TEMPLATES_DIR))
		: null;
	if (templatesDirId != null) excludeIds.push(templatesDirId);

	const found = await findDocumentByNameInTree(
		auth.baseUrl,
		auth.authToken,
		myDocsResult.directory_id,
		fileName,
		8,
		{ excludeDirectoryIds: excludeIds }
	);
	if (!found.ok) return found;

	let resolvedVia = found.resolved_via;
	if (excludeIds.length > 0) {
		resolvedVia =
			found.resolved_via === 'my_documents_tree_confusable'
				? 'name_exclude_templates_confusable'
				: 'name_exclude_templates';
	}

	const result = {
		ok: true,
		document_id: found.document_id,
		file_name: found.file_name,
		directory_id: found.directory_id,
		resolved_via: resolvedVia
	};
	if (requestedDocumentId != null && requestedDocumentId !== found.document_id) {
		result.requested_document_id = requestedDocumentId;
	}
	if (skillStorage) {
		skillStorage.set(hostDocCacheKey(fileName), String(found.document_id));
		skillStorage.set(STORAGE_KEY_MY_DOCS, String(myDocsResult.directory_id));
	}
	return result;
}

/**
 * Plan B: resolve host B by explicit id or by file_name in «Мои документы» (examples_sergey-style).
 */
async function resolveHostDocument(state, params, auth) {
	const raw = params && typeof params === 'object' ? params : {};
	const skillStorage = auth.skillStorage || resolveSkillStorage(state);
	const requestedExplicitId = parsePositiveId(
		raw.host_document_id != null ? raw.host_document_id : raw.document_id
	);
	let explicitId = requestedExplicitId;
	const fileName = normalizeHostFileName(
		pickString(raw.host_file_name) || pickString(raw.file_name)
	);

	if (explicitId != null) {
		const validation = await validateExplicitHostId(
			auth.baseUrl,
			auth.authToken,
			explicitId,
			fileName,
			skillStorage
		);
		if (!validation.ok) {
			explicitId = null;
		}
	}

	if (explicitId != null) {
		const record = await fetchDocumentRecordById(auth.baseUrl, auth.authToken, explicitId);
		const diskName = record.ok ? record.file_name : '';
		const resolvedName = fileName || diskName || 'document.docx';
		if (skillStorage && fileName) {
			skillStorage.set(hostDocCacheKey(fileName), String(explicitId));
		}
		const hostResult = {
			ok: true,
			document_id: explicitId,
			file_name: resolvedName,
			resolved_via: 'explicit_id'
		};
		if (diskName) hostResult.disk_name = diskName;
		if (requestedExplicitId != null && requestedExplicitId !== explicitId) {
			hostResult.requested_document_id = requestedExplicitId;
		}
		return hostResult;
	}

	if (!fileName) {
		return {
			ok: false,
			error: 'Нужны host_file_name (имя открытого документа) или host_document_id.',
			agent_message:
				'Не удалось определить документ: укажите имя файла из редактора или откройте документ с Р7-Диска.'
		};
	}

	if (skillStorage) {
		const cached = parsePositiveId(skillStorage.get(hostDocCacheKey(fileName)));
		if (cached != null && !isTemplateDocumentId(cached, skillStorage)) {
			const validation = await validateExplicitHostId(
				auth.baseUrl,
				auth.authToken,
				cached,
				fileName,
				skillStorage
			);
			if (validation.ok) {
				const cachedResult = {
					ok: true,
					document_id: cached,
					file_name: fileName,
					resolved_via: 'skill_storage'
				};
				if (validation.disk_name) cachedResult.disk_name = validation.disk_name;
				return cachedResult;
			}
			skillStorage.set(hostDocCacheKey(fileName), '');
		}
	}

	const found = await findHostDocumentByName(auth, fileName, skillStorage, requestedExplicitId);
	if (!found.ok && requestedExplicitId != null) {
		return {
			ok: false,
			error: found.error,
			agent_message:
				'Не найден файл «' +
				fileName +
				'» по имени. Переданный document_id=' +
				requestedExplicitId +
				' не совпадает с именем на диске или указывает на шаблон — проверьте supplement и обновите контекст в плагине.'
		};
	}
	return found;
}

/**
 * Fetch host B text; on Download 404 for explicit_id — fallback by file_name (examples_sergey-style).
 */
async function fetchHostDocumentText(state, params, auth, maxBytes) {
	const raw = params && typeof params === 'object' ? params : {};
	const skillStorage = auth.skillStorage || resolveSkillStorage(state);
	const hostResult = await resolveHostDocument(state, raw, auth);
	if (!hostResult.ok) return hostResult;

	const fileName = normalizeHostFileName(
		pickString(raw.host_file_name) || pickString(raw.file_name) || hostResult.file_name
	);

	let result = await fetchDocumentText(
		auth.baseUrl,
		auth.authToken,
		hostResult.document_id,
		hostResult.file_name,
		maxBytes
	);

	const is404 =
		!result.ok &&
		typeof result.error === 'string' &&
		/Download HTTP 404/i.test(result.error);

	if (is404 && fileName) {
		const found = await findHostDocumentByName(
			auth,
			fileName,
			skillStorage,
			hostResult.requested_document_id || hostResult.document_id
		);
		if (found.ok) {
			result = await fetchDocumentText(
				auth.baseUrl,
				auth.authToken,
				found.document_id,
				found.file_name || fileName,
				maxBytes
			);
			if (result.ok) {
				result.resolved_via = found.resolved_via || 'name_fallback';
				result.requested_document_id =
					hostResult.requested_document_id || hostResult.document_id;
				result.document_id = found.document_id;
				result.file_name = found.file_name || fileName;
				if (found.disk_name) result.disk_name = found.disk_name;
			}
		}
	} else if (result.ok && fileName) {
		const record = await fetchDocumentRecordById(
			auth.baseUrl,
			auth.authToken,
			hostResult.document_id
		);
		const diskName = record.ok ? record.file_name : hostResult.disk_name || '';
		if (diskName) result.disk_name = diskName;
		const nameMismatch =
			diskName && !fileNamesMatchForLookup(diskName, fileName);
		if (nameMismatch) {
			const found = await findHostDocumentByName(
				auth,
				fileName,
				skillStorage,
				hostResult.requested_document_id || hostResult.document_id
			);
			if (found.ok && found.document_id !== hostResult.document_id) {
				const retry = await fetchDocumentText(
					auth.baseUrl,
					auth.authToken,
					found.document_id,
					found.file_name || fileName,
					maxBytes
				);
				if (retry.ok) {
					result = retry;
					result.resolved_via = found.resolved_via || 'name_fallback';
					result.requested_document_id =
						hostResult.requested_document_id || hostResult.document_id;
					result.document_id = found.document_id;
					result.file_name = found.file_name || fileName;
					result.disk_name = found.file_name || diskName;
				}
			}
		}
	}

	if (result.ok && !result.resolved_via) {
		result.resolved_via = hostResult.resolved_via;
	}
	if (result.ok && hostResult.disk_name && !result.disk_name) {
		result.disk_name = hostResult.disk_name;
	}
	if (result.ok && hostResult.requested_document_id && !result.requested_document_id) {
		result.requested_document_id = hostResult.requested_document_id;
	}

	return result;
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

function decodeXmlText(text) {
	return String(text || '')
		.replace(/&lt;/g, '<')
		.replace(/&gt;/g, '>')
		.replace(/&amp;/g, '&')
		.replace(/&quot;/g, '"')
		.replace(/&apos;/g, "'");
}

async function inflateZipEntry(data, method) {
	if (method === 0) {
		return data;
	}
	if (method === 8) {
		const g = typeof globalThis !== 'undefined' ? globalThis : {};
		if (!g.DecompressionStream || !g.Blob || !g.Response) {
			throw new Error('ZIP deflate: DecompressionStream недоступен в среде навыка.');
		}
		const formats = ['deflate', 'deflate-raw'];
		let lastError = '';
		for (let i = 0; i < formats.length; i += 1) {
			try {
				const stream = new g.Blob([data]).stream().pipeThrough(
					new g.DecompressionStream(formats[i])
				);
				const buf = await new g.Response(stream).arrayBuffer();
				if (buf.byteLength > 0) {
					return new Uint8Array(buf);
				}
			} catch (err) {
				lastError = errorMessage(err);
			}
		}
		throw new Error('ZIP deflate: ' + (lastError || 'пустой результат'));
	}
	throw new Error('ZIP: неподдерживаемый метод сжатия ' + method);
}

async function readZipEntriesAsync(bytes) {
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	let eocdOffset = -1;
	for (let i = bytes.length - 22; i >= 0; i -= 1) {
		if (view.getUint32(i, true) === 0x06054b50) {
			eocdOffset = i;
			break;
		}
	}
	if (eocdOffset < 0) {
		throw new Error('ZIP: EOCD не найден.');
	}

	const entryCount = view.getUint16(eocdOffset + 10, true);
	const centralDirOffset = view.getUint32(eocdOffset + 16, true);
	const entries = [];
	let pos = centralDirOffset;

	for (let e = 0; e < entryCount; e += 1) {
		if (view.getUint32(pos, true) !== 0x02014b50) break;
		const compMethod = view.getUint16(pos + 10, true);
		const compSize = view.getUint32(pos + 20, true);
		const nameLen = view.getUint16(pos + 28, true);
		const extraLen = view.getUint16(pos + 30, true);
		const commentLen = view.getUint16(pos + 32, true);
		const localOffset = view.getUint32(pos + 42, true);
		const name = decodeUtf8(bytes.subarray(pos + 46, pos + 46 + nameLen)).replace(/\\/g, '/');
		pos += 46 + nameLen + extraLen + commentLen;

		const localPos = localOffset;
		if (view.getUint32(localPos, true) !== 0x04034b50) continue;
		const localNameLen = view.getUint16(localPos + 26, true);
		const localExtraLen = view.getUint16(localPos + 28, true);
		const dataStart = localPos + 30 + localNameLen + localExtraLen;
		const raw = bytes.subarray(dataStart, dataStart + compSize);
		const data = await inflateZipEntry(raw, compMethod);
		entries.push({ path: name, data: data });
	}
	return entries;
}

function extractPlainTextFromDocxParagraph(paragraphXml) {
	const parts = [];
	const tokenRe = /<w:t[^>]*>([^<]*)<\/w:t>|<w:tab\s*\/>|<w:br\s*\/>|<w:cr\s*\/>/g;
	let tokenMatch = tokenRe.exec(paragraphXml);
	while (tokenMatch) {
		if (tokenMatch[1] != null) {
			parts.push(decodeXmlText(tokenMatch[1]));
		} else {
			parts.push('\n');
		}
		tokenMatch = tokenRe.exec(paragraphXml);
	}
	if (parts.length === 0) {
		const tRe = /<w:t[^>]*>([^<]*)<\/w:t>/g;
		let tMatch = tRe.exec(paragraphXml);
		while (tMatch) {
			parts.push(decodeXmlText(tMatch[1]));
			tMatch = tRe.exec(paragraphXml);
		}
	}
	return parts.join('');
}

function extractPlainTextFromDocxXml(docXml) {
	const paragraphs = [];
	const pRe = /<w:p\b[^>]*>([\s\S]*?)<\/w:p>/g;
	let pMatch = pRe.exec(docXml);
	while (pMatch) {
		paragraphs.push(extractPlainTextFromDocxParagraph(pMatch[1]));
		pMatch = pRe.exec(docXml);
	}
	if (paragraphs.length === 0) {
		paragraphs.push(extractPlainTextFromDocxParagraph(docXml));
	}
	return paragraphs
		.map(function (line) {
			return line.trimEnd();
		})
		.filter(function (line, index, arr) {
			return line.length > 0 || (index > 0 && index < arr.length - 1);
		})
		.join('\n')
		.trim();
}

async function extractDocxPlainText(bytes) {
	const entries = await readZipEntriesAsync(bytes);
	for (let i = 0; i < entries.length; i += 1) {
		if (entries[i].path === 'word/document.xml') {
			return extractPlainTextFromDocxXml(decodeUtf8(entries[i].data));
		}
	}
	return '';
}

async function extractTextFromBytes(bytes, fileName) {
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
	let rawText = '';
	try {
		rawText = await extractTextFromBytes(downloaded.bytes, fileName);
	} catch (err) {
		return {
			ok: false,
			error:
				'Не удалось извлечь текст из «' +
				fileName +
				'»: ' +
				errorMessage(err)
		};
	}
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
