/**
 * Folder operations on R7-Disk (KS 2024 DocumentDirectory API).
 * @param {Record<string, unknown>} state
 * @param {{
 *   action?: unknown,
 *   parent_directory_id?: unknown,
 *   folder_id?: unknown,
 *   folder_ids?: unknown,
 *   to_directory_id?: unknown,
 *   name?: unknown,
 *   folder_path?: unknown,
 *   rule?: unknown,
 *   auth_token?: unknown,
 *   base_url?: unknown,
 *   login?: unknown,
 *   password?: unknown
 * }} params
 */
/**
 * VM bootstrap может передать аргументы через globalThis.input.
 * @returns {Record<string, unknown> | null}
 */
function readGlobalToolInput() {
	try {
		/** @type {Record<string, unknown>} */
		const g =
			typeof globalThis !== 'undefined'
				? /** @type {Record<string, unknown>} */ (globalThis)
				: {};
		const value = g['input'];
		if (value && typeof value === 'object' && !Array.isArray(value)) {
			return /** @type {Record<string, unknown>} */ (value);
		}
	} catch {
		/* ignore */
	}
	return null;
}

/**
 * @param {unknown} raw
 * @param {Record<string, unknown>} [state]
 * @returns {Record<string, unknown>}
 */
function normalizeToolParams(raw, state) {
	/** @type {Record<string, unknown>} */
	let base = {};
	if (typeof raw === 'string' && raw.trim()) {
		try {
			const parsed = JSON.parse(raw);
			if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
				base = /** @type {Record<string, unknown>} */ (parsed);
			}
		} catch {
			base = {};
		}
	} else if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
		base = /** @type {Record<string, unknown>} */ (raw);
	}
	const nestedKeys = ['input', 'arguments', 'params', 'payload', 'tool_input'];
	for (const key of nestedKeys) {
		const nested = base[key];
		if (nested && typeof nested === 'object' && !Array.isArray(nested)) {
			base = { ...base, .../** @type {Record<string, unknown>} */ (nested) };
		}
	}
	if (state && typeof state === 'object') {
		for (const key of nestedKeys) {
			const nested = state[key];
			if (nested && typeof nested === 'object' && !Array.isArray(nested)) {
				const nestedRecord = /** @type {Record<string, unknown>} */ (nested);
				if (!resolveToolAction(base) && resolveToolAction(nestedRecord)) {
					base = { ...base, ...nestedRecord };
				}
			}
		}
	}
	const globalInput = readGlobalToolInput();
	if (globalInput && (Object.keys(base).length === 0 || !resolveToolAction(base))) {
		base = { ...globalInput, ...base };
	}
	return base;
}

/**
 * @param {Record<string, unknown>} params
 * @returns {string}
 */
function resolveToolAction(params) {
	const candidates = [
		params.operation,
		params.action,
		params.tool_action,
		params['Operation'],
		params['Action']
	];
	for (const value of candidates) {
		if (typeof value === 'string' && value.trim()) {
			return value.trim().toLowerCase();
		}
	}
	return '';
}

async function handler(state, params) {
	const input = normalizeToolParams(params, /** @type {Record<string, unknown>} */ (state));
	const action = resolveToolAction(input);
	if (!action) {
		return {
			ok: false,
			error:
				'Не задан operation (или action). Допустимо: create, move, copy, delete, restore, conflict, rename (справка).',
			debug_received_keys: Object.keys(input),
			debug_raw_param_type: params == null ? 'null' : typeof params
		};
	}

	const userEnv = readUserEnv(state);
	const skillStorage = resolveSkillStorage(state);
	const baseUrl = resolveBaseUrl(state, input, skillStorage);
	const login = pickString(input?.login, userEnv.R7_DISK_LOGIN);
	const password = pickString(input?.password, userEnv.R7_DISK_PASSWORD);

	if (!baseUrl) {
		return { ok: false, error: 'Не задан R7_DISK_BASE_URL.' };
	}

	const authResult = await ensureAuthToken(
		baseUrl,
		login,
		password,
		skillStorage,
		input?.auth_token
	);
	if (!authResult.ok) return { ok: false, error: authResult.error };
	const authToken = authResult.auth_token;

	try {
		switch (action) {
			case 'create':
				return await actionCreate(
					baseUrl,
					authToken,
					input,
					state,
					skillStorage,
					userEnv
				);
			case 'move':
				return await actionMove(baseUrl, authToken, input);
			case 'copy':
				return await actionCopy(baseUrl, authToken, input);
			case 'delete':
				return await actionDelete(baseUrl, authToken, input);
			case 'restore':
				return await actionRestore(baseUrl, authToken, input);
			case 'conflict':
				return await actionConflict(baseUrl, authToken, input);
			case 'rename':
				return actionRenameFolderHelp(input);
			default:
				return {
					ok: false,
					error: `Неизвестный action "${action}". Допустимо: create, move, copy, delete, restore, conflict, rename (справка).`
				};
		}
	} catch (err) {
		return { ok: false, error: errorMessage(err) };
	}
}

/**
 * KS 2024 API не содержит DocumentDirectory/Rename — только справка и обходной путь.
 * @param {Record<string, unknown>} params
 */
function actionRenameFolderHelp(params) {
	const folderId = resolvePositiveId(params?.folder_id);
	const newName = typeof params?.name === 'string' ? params.name.trim() : '';
	return {
		ok: false,
		impossible: true,
		action: 'rename',
		folder_id: folderId,
		new_name: newName || null,
		error:
			'Действие невозможно: переименование папок не поддерживается API Р7-Диска (KS 2024). ' +
			'Переименование доступно только для файлов (r7_disk_document, action rename).'
	};
}

/**
 * @param {string} baseUrl
 * @param {string} authToken
 * @param {Record<string, unknown>} params
 */
async function actionCreate(baseUrl, authToken, params, state, skillStorage, userEnv) {
	const parentId = await resolveParentDirectoryId(
		baseUrl,
		authToken,
		params,
		skillStorage,
		userEnv
	);
	if (parentId == null) {
		return buildMissingParentError(params, skillStorage, userEnv);
	}

	const folderPathRaw =
		typeof params?.folder_path === 'string' ? params.folder_path.trim() : '';
	const nameRaw = typeof params?.name === 'string' ? params.name.trim() : '';
	const batchNames = resolveFolderNameList(params);
	const segments = folderPathRaw
		? folderPathRaw.split('/').map((s) => s.trim()).filter(Boolean)
		: batchNames.length > 0
			? batchNames
			: nameRaw
				? [nameRaw]
				: [];

	if (segments.length === 0) {
		return {
			ok: false,
			error:
				'Для create укажите name (одна папка), names (массив имён) или folder_path (например "Отчёты/2026/Январь").'
		};
	}

	/** @type {Array<{ name: string, id: number }>} */
	const created = [];
	const isNestedPath = folderPathRaw.length > 0 && segments.length > 1;
	let currentParentId = parentId;

	for (let index = 0; index < segments.length; index++) {
		const segment = segments[index];
		const segmentParentId = isNestedPath ? currentParentId : parentId;
		const result = await postAddSubDirectory(baseUrl, authToken, segmentParentId, segment);
		if (!result.ok) {
			return {
				ok: false,
				error: result.error,
				error_code: result.error_code,
				created_folders: created,
				parent_directory_id: parentId,
				fix_step: result.fix_step,
				api_base_url: baseUrl
			};
		}
		const folderId = result.folder_id;
		if (folderId == null) {
			return {
				ok: false,
				error: `Папка "${segment}" создана, но ID не найден в ответе API.`,
				created_folders: created,
				api_base_url: baseUrl
			};
		}
		created.push({ name: segment, id: folderId });
		if (isNestedPath) {
			currentParentId = folderId;
		}
	}

	const last = created[created.length - 1];
	const batchCount = !folderPathRaw && batchNames.length > 1 ? batchNames.length : 1;
	const agentMessage =
		batchCount > 1
			? `Создано ${created.length} папок в «Мои документы» (родитель id=${parentId}): ${created.map((f) => `«${f.name}» id=${f.id}`).join(', ')}.`
			: `Папка «${last.name}» создана (id=${last.id}, родитель id=${parentId}).`;

	return withFactualCitation(
		{
			ok: true,
			action: 'create',
			folder_id: last.id,
			folder_name: last.name,
			parent_directory_id: parentId,
			created_folders: created,
			agent_message: agentMessage,
			do_not_retry: true,
			forbid_followup_tools: [
				'r7_disk_folder',
				'r7_disk_login',
				'r7_disk_list_directory',
				'list_directory'
			],
			api_base_url: baseUrl
		},
		['created_folders', 'folder_id', 'folder_name', 'agent_message']
	);
}

/**
 * @param {Record<string, unknown>} params
 * @returns {string[]}
 */
function resolveFolderNameList(params) {
	const raw = params?.names;
	if (!Array.isArray(raw)) return [];
	/** @type {string[]} */
	const names = [];
	for (const item of raw) {
		if (typeof item === 'string' && item.trim()) {
			names.push(item.trim());
		}
	}
	return names;
}

/**
 * @param {string} baseUrl
 * @param {string} authToken
 * @param {Record<string, unknown>} params
 * @param {SkillKeyValueStorage | null} skillStorage
 * @param {Record<string, unknown>} userEnv
 * @returns {Promise<number | null>}
 */
async function resolveParentDirectoryId(baseUrl, authToken, params, skillStorage, userEnv) {
	const direct = resolvePositiveId(params?.parent_directory_id);
	if (direct != null) return direct;

	const fromAlias = resolvePositiveId(params?.my_documents_directory_id);
	if (fromAlias != null) return fromAlias;

	const fromNestedTarget = extractParentFromCreateTarget(params?.create_target);
	if (fromNestedTarget != null) return fromNestedTarget;

	let fromCache = resolveDefaultParentDirectoryId(skillStorage, userEnv);
	if (fromCache != null) return fromCache;

	if (authToken && baseUrl) {
		const discovered = await discoverPersonalRootQuick(baseUrl, authToken);
		if (discovered != null) {
			persistCreateTarget(skillStorage, discovered.id, discovered.name);
			return discovered.id;
		}
	}

	return null;
}

/**
 * @param {unknown} value
 * @returns {number | null}
 */
function extractParentFromCreateTarget(value) {
	if (!value || typeof value !== 'object') return null;
	const target = /** @type {Record<string, unknown>} */ (value);
	return resolvePositiveId(target.parent_directory_id);
}

/**
 * @param {Record<string, unknown>} params
 * @param {SkillKeyValueStorage | null} skillStorage
 * @param {Record<string, unknown>} userEnv
 */
function buildMissingParentError(params, skillStorage, userEnv) {
	const cachedParent = resolveDefaultParentDirectoryId(skillStorage, userEnv);
	const authToken = typeof params?.auth_token === 'string' ? params.auth_token.trim() : '';
	/** @type {Record<string, unknown>} */
	const example = {
		operation: 'create',
		name: 'Имя_папки'
	};
	if (authToken) example.auth_token = authToken;
	if (cachedParent != null) {
		example.parent_directory_id = cachedParent;
	} else {
		example.parent_directory_id = '<create_target.parent_directory_id из r7_disk_login>';
		if (!authToken) {
			example.auth_token = '<auth_token из r7_disk_login>';
		}
	}

	return {
		ok: false,
		error:
			'Не найден родительский каталог. Сначала r7_disk_login, затем create с auth_token и parent_directory_id из ответа.',
		error_code: 'MISSING_PARENT',
		hint:
			'Кэш skillStorage между вызовами tools на платформе может быть недоступен — всегда передавайте auth_token и parent_directory_id из ответа login.',
		folder_create_example: example,
		do_not_retry: true,
		forbid_variants: ['web_url', 'disk_section', 'folder_path без parent', 'повторный login'],
		agent_message:
			'Создание папки: один login, затем folder create с auth_token и parent_directory_id из create_target. Не перебирайте варианты.'
	};
}

/**
 * @param {SkillKeyValueStorage | null} skillStorage
 * @param {number} parentId
 * @param {string} parentName
 */
function persistCreateTarget(skillStorage, parentId, parentName) {
	if (!skillStorage) return;
	skillStorage.set('r7_disk_my_documents_directory_id', String(parentId));
	skillStorage.set(
		'r7_disk_create_target',
		JSON.stringify({
			parent_directory_id: parentId,
			parent_name: parentName,
			disk_section: 'docs',
			can_create_here: true
		})
	);
}

const QUICK_ROOT_PROBE_IDS = [61, 1, 5, 9, 62, 63, 64, 65, 66, 67, 42, 50, 2, 3, 4];

/**
 * @param {string} baseUrl
 * @param {string} authToken
 * @returns {Promise<{ id: number, name: string } | null>}
 */
async function discoverPersonalRootQuick(baseUrl, authToken) {
	for (const candidateId of QUICK_ROOT_PROBE_IDS) {
		const fetched = await fetchDirectoryEntry(baseUrl, authToken, candidateId);
		if (!fetched.entry) continue;
		const entry = fetched.entry;
		const name = typeof entry.Name === 'string' ? entry.Name.trim() : '';
		const entryId = typeof entry.Id === 'number' ? entry.Id : candidateId;
		if (/мои\s*документ|my\s*documents/i.test(name)) {
			return { id: entryId, name: name || 'Мои документы' };
		}
	}
	return null;
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
 * @param {string} baseUrl
 * @param {string} authToken
 * @param {Record<string, unknown>} params
 */
async function actionMove(baseUrl, authToken, params) {
	const folderId = resolvePositiveId(params?.folder_id);
	const toDirectoryId = resolvePositiveId(params?.to_directory_id);
	if (folderId == null || toDirectoryId == null) {
		return { ok: false, error: 'Для move нужны folder_id и to_directory_id (> 0).' };
	}

	const url =
		`${baseUrl}/api/v1/DocumentDirectory/Move?` +
		`Id=${encodeURIComponent(String(folderId))}&` +
		`toDirectoryId=${encodeURIComponent(String(toDirectoryId))}`;

	const http = await apiRequest('GET', url, authToken);
	if (!http.ok) return { ok: false, error: http.error, api_base_url: baseUrl };

	return {
		ok: true,
		action: 'move',
		folder_id: folderId,
		to_directory_id: toDirectoryId,
		data: toApiRecord(http.data),
		api_base_url: baseUrl
	};
}

/**
 * @param {string} baseUrl
 * @param {string} authToken
 * @param {Record<string, unknown>} params
 */
async function actionCopy(baseUrl, authToken, params) {
	const folderId = resolvePositiveId(params?.folder_id);
	const toDirectoryId = resolvePositiveId(params?.to_directory_id);
	if (folderId == null || toDirectoryId == null) {
		return { ok: false, error: 'Для copy нужны folder_id и to_directory_id (> 0).' };
	}

	const rule = resolveCopyRule(params?.rule);
	const url =
		`${baseUrl}/api/v1/DocumentDirectory/Copy?` +
		`Id=${encodeURIComponent(String(folderId))}&` +
		`toDirectoryId=${encodeURIComponent(String(toDirectoryId))}&` +
		`rule=${encodeURIComponent(String(rule))}`;

	const http = await apiRequest('GET', url, authToken);
	if (!http.ok) return { ok: false, error: http.error, api_base_url: baseUrl };

	return {
		ok: true,
		action: 'copy',
		folder_id: folderId,
		to_directory_id: toDirectoryId,
		rule,
		data: toApiRecord(http.data),
		api_base_url: baseUrl
	};
}

/**
 * @param {string} baseUrl
 * @param {string} authToken
 * @param {Record<string, unknown>} params
 */
async function actionDelete(baseUrl, authToken, params) {
	const folderId = resolvePositiveId(params?.folder_id);
	if (folderId == null) {
		return { ok: false, error: 'Для delete нужен folder_id (> 0).' };
	}

	const url = `${baseUrl}/api/v1/DocumentDirectory/Delete?Id=${encodeURIComponent(String(folderId))}`;
	const http = await apiRequest('DELETE', url, authToken);
	if (!http.ok) return { ok: false, error: http.error, api_base_url: baseUrl };

	return {
		ok: true,
		action: 'delete',
		folder_id: folderId,
		data: toApiRecord(http.data),
		api_base_url: baseUrl
	};
}

/**
 * @param {string} baseUrl
 * @param {string} authToken
 * @param {Record<string, unknown>} params
 */
async function actionRestore(baseUrl, authToken, params) {
	const ids = resolveIdList(params?.folder_ids, params?.folder_id);
	if (ids.length === 0) {
		return { ok: false, error: 'Для restore укажите folder_id или массив folder_ids.' };
	}

	const url = `${baseUrl}/api/v1/DocumentDirectory/Restore`;
	const http = await apiRequest('POST', url, authToken, { Ids: ids });
	if (!http.ok) return { ok: false, error: http.error, api_base_url: baseUrl };

	return {
		ok: true,
		action: 'restore',
		folder_ids: ids,
		data: toApiRecord(http.data),
		api_base_url: baseUrl
	};
}

/**
 * @param {string} baseUrl
 * @param {string} authToken
 * @param {Record<string, unknown>} params
 */
async function actionConflict(baseUrl, authToken, params) {
	const ids = resolveIdList(params?.folder_ids, params?.folder_id);
	const toDirectoryId = resolvePositiveId(params?.to_directory_id);
	if (ids.length === 0 || toDirectoryId == null) {
		return {
			ok: false,
			error: 'Для conflict нужны folder_id или folder_ids и to_directory_id (> 0).'
		};
	}

	const url = `${baseUrl}/api/v1/DocumentDirectory/Conflict`;
	const http = await apiRequest('POST', url, authToken, {
		Ids: ids,
		ToDirectoryId: toDirectoryId
	});
	if (!http.ok) return { ok: false, error: http.error, api_base_url: baseUrl };

	return {
		ok: true,
		action: 'conflict',
		folder_ids: ids,
		to_directory_id: toDirectoryId,
		data: toApiRecord(http.data),
		api_base_url: baseUrl
	};
}

/**
 * @param {unknown} value
 * @returns {Record<string, unknown>}
 */
function toApiRecord(value) {
	if (value && typeof value === 'object' && !Array.isArray(value)) {
		return /** @type {Record<string, unknown>} */ (value);
	}
	if (value == null) return {};
	return { result: value };
}

/**
 * @param {string} baseUrl
 * @param {string} authToken
 * @param {number} parentId
 * @param {string} name
 */
async function postAddSubDirectory(baseUrl, authToken, parentId, name) {
	const url = `${baseUrl}/api/v1/DocumentDirectory/AddSubDirectory`;
	const bodies = [
		{ ParentId: parentId, Name: name },
		{ DirectoryId: parentId, Name: name },
		{ parentId: parentId, name: name }
	];

	let lastError = '';
	let lastStatus = null;
	for (const body of bodies) {
		const http = await apiRequest('POST', url, authToken, body);
		if (http.ok) {
			const folderId = extractFolderId(http.data);
			return { ok: true, folder_id: folderId, data: http.data };
		}
		lastError = http.error ?? 'AddSubDirectory failed';
		lastStatus = http.status ?? null;
		if (http.status !== 400 && http.status !== 422) break;
	}

	if (lastStatus === 406) {
		const getUrl =
			`${url}?ParentId=${encodeURIComponent(String(parentId))}&Name=${encodeURIComponent(name)}`;
		const getHttp = await apiRequest('GET', getUrl, authToken);
		if (getHttp.ok) {
			const folderId = extractFolderId(getHttp.data);
			return { ok: true, folder_id: folderId, data: getHttp.data };
		}
		lastError = getHttp.error ?? lastError;
		lastStatus = getHttp.status ?? lastStatus;
	}

	if (lastStatus === 406 || lastStatus === 401 || lastStatus === 403) {
		return {
			ok: false,
			error: `HTTP ${lastStatus}: нет доступа или устарел auth_token. Выполните r7_disk_login и передайте auth_token в folder create.`,
			error_code: 'AUTH_OR_ACCESS',
			fix_step:
				'r7_disk_login → r7_disk_folder с auth_token и parent_directory_id из create_target'
		};
	}

	return { ok: false, error: lastError, error_code: 'ADD_SUBDIRECTORY_FAILED' };
}

/**
 * @param {string} method
 * @param {string} url
 * @param {string} authToken
 * @param {Record<string, unknown> | null} [body]
 */
async function apiRequest(method, url, authToken, body = null) {
	/** @type {RequestInit} */
	const init = {
		method,
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
		return { ok: false, error: `Сетевая ошибка ${method} ${url}: ${errorMessage(err)}` };
	}

	const rawText = await readUtf8Text(response);
	let payload = null;
	if (rawText) {
		try {
			payload = JSON.parse(rawText);
		} catch {
			if (!response.ok) {
				return {
					ok: false,
					status: response.status,
					error: `HTTP ${response.status}: ${truncate(rawText, 300)}`
				};
			}
			payload = rawText;
		}
	}

	if (!response.ok) {
		return {
			ok: false,
			status: response.status,
			error: `HTTP ${response.status}: ${truncate(rawText, 400)}`
		};
	}

	return { ok: true, status: response.status, data: unwrapApiData(payload) };
}

/**
 * @param {{ text: () => Promise<string> }} response
 * @returns {Promise<string>}
 */
async function readUtf8Text(response) {
	return response.text();
}

/**
 * @param {unknown} payload
 * @returns {unknown}
 */
function unwrapApiData(payload) {
	if (payload && typeof payload === 'object' && 'Response' in payload) {
		const response = /** @type {{ Response?: { Data?: unknown } }} */ (payload).Response;
		if (response && typeof response === 'object' && 'Data' in response) {
			return response.Data ?? payload;
		}
	}
	return payload;
}

/**
 * @param {unknown} payload
 * @returns {number | null}
 */
function extractFolderId(payload) {
	const data = unwrapApiData(payload);
	if (typeof data === 'number' && Number.isFinite(data)) return data;
	if (data && typeof data === 'object') {
		const obj = /** @type {Record<string, unknown>} */ (data);
		if (typeof obj.Id === 'number') return obj.Id;
		if (typeof obj.id === 'number') return obj.id;
	}
	if (Array.isArray(data)) {
		for (const item of data) {
			const id = extractFolderId(item);
			if (id != null) return id;
		}
	}
	return null;
}

/**
 * @param {unknown} primary
 * @param {unknown} [secondary]
 * @returns {number[]}
 */
function resolveIdList(primary, secondary) {
	const fromPrimary = normalizeIdArray(primary);
	if (fromPrimary.length > 0) return fromPrimary;
	const single = resolvePositiveId(secondary);
	return single != null ? [single] : [];
}

/**
 * @param {unknown} value
 * @returns {number[]}
 */
function normalizeIdArray(value) {
	if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
		return [Math.trunc(value)];
	}
	if (typeof value === 'string' && value.trim()) {
		const parsed = Number(value.trim());
		if (Number.isFinite(parsed) && parsed > 0) return [Math.trunc(parsed)];
	}
	if (!Array.isArray(value)) return [];
	/** @type {number[]} */
	const ids = [];
	for (const item of value) {
		const id = resolvePositiveId(item);
		if (id != null) ids.push(id);
	}
	return ids;
}

/**
 * @param {SkillKeyValueStorage | null} skillStorage
 * @param {Record<string, unknown>} userEnv
 * @returns {number | null}
 */
function resolveDefaultParentDirectoryId(skillStorage, userEnv) {
	const fromEnv = resolvePositiveId(userEnv.R7_DISK_DEFAULT_PARENT_DIRECTORY_ID);
	if (fromEnv != null) return fromEnv;
	if (!skillStorage) return null;

	const createRaw = skillStorage.get('r7_disk_create_target');
	if (typeof createRaw === 'string' && createRaw.trim()) {
		try {
			const target = JSON.parse(createRaw);
			if (target && typeof target === 'object' && target.can_create_here === true) {
				const fromTarget = resolvePositiveId(target.parent_directory_id);
				if (fromTarget != null) return fromTarget;
			}
		} catch {
			/* ignore */
		}
	}

	const cached = skillStorage.get('r7_disk_my_documents_directory_id');
	const fromCache = resolvePositiveId(cached);
	if (fromCache != null) return fromCache;

	const rootsRaw = skillStorage.get('r7_disk_accessible_roots');
	if (typeof rootsRaw === 'string' && rootsRaw.trim()) {
		try {
			const roots = JSON.parse(rootsRaw);
			if (Array.isArray(roots) && roots.length > 0) {
				const personal = roots.find(
					(r) =>
						r &&
						typeof r === 'object' &&
						typeof r.name === 'string' &&
						/мои\s*документ|my\s*documents/i.test(r.name)
				);
				if (personal && typeof personal.id === 'number') return personal.id;
				const shared = roots.find(
					(r) =>
						r &&
						typeof r === 'object' &&
						typeof r.name === 'string' &&
						!/^(общ|common|shared|корзин|избран|ладкрафт)/i.test(r.name) &&
						!/мои\s*документ|my\s*documents/i.test(r.name)
				);
				if (shared && typeof shared.id === 'number') return shared.id;
			}
		} catch {
			/* ignore */
		}
	}
	return null;
}

/**
 * @param {unknown} value
 * @returns {number | null}
 */
function resolvePositiveId(value) {
	if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
		return Math.trunc(value);
	}
	if (typeof value === 'string' && value.trim()) {
		const parsed = Number(value.trim());
		if (Number.isFinite(parsed) && parsed > 0) return Math.trunc(parsed);
	}
	return null;
}

/**
 * @param {unknown} value
 * @returns {0 | 1 | 2}
 */
function resolveCopyRule(value) {
	if (value === 0 || value === 1 || value === 2) return value;
	if (typeof value === 'string') {
		const trimmed = value.trim();
		if (trimmed === '0' || trimmed === '1' || trimmed === '2') {
			return /** @type {0 | 1 | 2} */ (Number(trimmed));
		}
	}
	return 0;
}

/**
 * @param {string} baseUrl
 * @param {string} login
 * @param {string} password
 * @param {SkillKeyValueStorage | null} skillStorage
 * @param {unknown} authTokenParam
 */
async function ensureAuthToken(baseUrl, login, password, skillStorage, authTokenParam) {
	let authToken = typeof authTokenParam === 'string' ? authTokenParam.trim() : '';
	if (!authToken && skillStorage) {
		const cached = skillStorage.get('r7_disk_auth_token');
		if (typeof cached === 'string' && cached.trim()) authToken = cached.trim();
	}
	if (authToken) return { ok: true, auth_token: authToken };
	const loginResult = await loginInline(baseUrl, login, password, skillStorage);
	if (!loginResult.ok) return { ok: false, error: loginResult.error };
	return { ok: true, auth_token: loginResult.auth_token };
}

/**
 * @param {string} baseUrl
 * @param {string} login
 * @param {string} password
 * @param {SkillKeyValueStorage | null} skillStorage
 */
async function loginInline(baseUrl, login, password, skillStorage) {
	if (!login || !password) {
		return {
			ok: false,
			error: 'Нет auth_token и не заданы R7_DISK_LOGIN/R7_DISK_PASSWORD для авто-login.'
		};
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
		const discovered = await discoverPersonalRootQuick(baseUrl, authToken);
		if (discovered != null) {
			persistCreateTarget(skillStorage, discovered.id, discovered.name);
		}
	}
	return { ok: true, auth_token: authToken };
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