/**
 * Скачивание файла с Р7-Диска — отдельный tool с кнопкой «Скачать файл» (виджет fileDownloadCard).
 */
async function handler(state, params) {
	/*__CURSOR_LADCRAFT_WIDGET_NAME__=fileDownloadCard*/
	const input = normalizeParams(params, state);
	const directoryId = parsePositiveId(input.directory_id);
	const fileName = pickString(input.name, input.file_name);
	const maxDownloadBytes = 5 * 1024 * 1024;

	if (directoryId == null || !fileName) {
		return {
			ok: false,
			error: 'Нужны directory_id и name (имя файла в папке).',
			required_example: { directory_id: 42, name: 'тестовый.txt' },
			debug_received_keys: Object.keys(input),
			agent_message:
				'Вызов r7_disk_download: укажите directory_id и name. Не используйте r7_disk_document для скачивания.'
		};
	}

	const userEnv = readUserEnv(state);
	const skillStorage = resolveSkillStorage(state);
	const baseUrl = resolveBaseUrl(state, input, skillStorage);
	if (!baseUrl) {
		return { ok: false, error: 'Не задан R7_DISK_BASE_URL.' };
	}

	const downloadDedupHit = resolveDownloadDedupHit(skillStorage, directoryId, fileName, input);
	if (downloadDedupHit) {
		return /** @type {Record<string, unknown> & { ok: boolean }} */ (downloadDedupHit);
	}

	const authResult = await ensureAuthToken(
		baseUrl,
		pickString(input.login, userEnv.R7_DISK_LOGIN),
		pickString(input.password, userEnv.R7_DISK_PASSWORD),
		skillStorage,
		input.auth_token
	);
	if (!authResult.ok) return { ok: false, error: authResult.error };

	const lookup = await findDocumentInDirectory(
		baseUrl,
		authResult.auth_token,
		directoryId,
		fileName
	);
	if (!lookup.ok) return /** @type {Record<string, unknown> & { ok: boolean }} */ (lookup);

	const documentId = parsePositiveId(lookup.document_id);
	const resolvedName = pickString(lookup.file_name, lookup.name);
	if (documentId == null || !resolvedName) {
		return { ok: false, error: 'Не удалось определить document_id или имя файла.' };
	}

	const viewOnlyBlock = resolveViewOnlyDownloadBlock(
		skillStorage,
		directoryId,
		resolvedName,
		documentId,
		input
	);
	if (viewOnlyBlock) return /** @type {Record<string, unknown> & { ok: boolean }} */ (viewOnlyBlock);

	const downloadUrl =
		`${baseUrl}/api/v1/Documents/Download?id=${encodeURIComponent(String(documentId))}` +
		`&_=${Date.now()}`;

	let response;
	try {
		response = await fetch(downloadUrl, {
			method: 'GET',
			headers: { Authorization: authResult.auth_token }
		});
	} catch (err) {
		return { ok: false, error: `Сетевая ошибка: ${errorMessage(err)}` };
	}

	if (!response.ok) {
		const errText = await readUtf8Text(response);
		return {
			ok: false,
			error: `Download HTTP ${response.status}: ${truncate(errText, 300)}`
		};
	}

	const contentType = response.headers.get('content-type') || 'application/octet-stream';
	const buffer = await response.arrayBuffer();
	const bytes = new Uint8Array(buffer);

	if (bytes.length > maxDownloadBytes) {
		return {
			ok: false,
			error: `Файл слишком большой (${bytes.length} байт). Лимит: ${maxDownloadBytes} байт.`,
			size_bytes: bytes.length
		};
	}

	let mimeForDataUrl = contentType.split(';')[0].trim() || 'application/octet-stream';
	if (mimeForDataUrl === 'application/octet-stream' && /\.txt$/i.test(resolvedName)) {
		mimeForDataUrl = 'text/plain; charset=utf-8';
	}

	const feedback = buildFeedbackPrompts(documentId, resolvedName);

	const downloadResult = {
		ok: true,
		action: 'download',
		document_id: documentId,
		directory_id: directoryId,
		name: fileName,
		file_name: resolvedName,
		content_type: mimeForDataUrl,
		size_bytes: bytes.length,
		content_base64: encodeBase64(bytes),
		content_base64_present: true,
		content_base64_bytes: bytes.length,
		deliverable: true,
		delivery_method: 'content_base64',
		download_ready: true,
		download_fresh: true,
		download_status: 'ready_in_widget',
		show_download_widget: true,
		do_not_retry: true,
		agent_stop: true,
		api_base_url: baseUrl,
		feedback_prompt_ok: feedback.feedback_prompt_ok,
		feedback_prompt_retry: feedback.feedback_prompt_retry,
		agent_message: `Нажмите «Скачать файл» в карточке — «${resolvedName}» (${bytes.length} байт).`,
		forbid_followup_tools: ['r7_disk_download', 'download', 'r7_disk_document']
	};
	persistDownloadDedup(skillStorage, directoryId, fileName, downloadResult);
	return /** @type {Record<string, unknown> & { ok: boolean }} */ (downloadResult);
}

/**
 * @param {string} fileName
 * @returns {string}
 */
function normalizeDownloadFileKey(fileName) {
	return fileName.trim().toLowerCase();
}

/**
 * @param {number} directoryId
 * @param {string} fileName
 * @returns {string}
 */
function buildDownloadDedupKey(directoryId, fileName) {
	return `r7_disk_dl_tool_done_${directoryId}_${normalizeDownloadFileKey(fileName)}`;
}

/**
 * @param {SkillKeyValueStorage | null} skillStorage
 * @param {number} directoryId
 * @param {string} fileName
 * @param {Record<string, unknown>} input
 * @returns {(Record<string, unknown> & { ok: boolean }) | null}
 */
function resolveDownloadDedupHit(skillStorage, directoryId, fileName, input) {
	if (!skillStorage || input.force_redownload === true || input.force_repeat === true) {
		return null;
	}
	const raw = skillStorage.get(buildDownloadDedupKey(directoryId, fileName));
	if (typeof raw !== 'string' || !raw.trim()) return null;
	try {
		const cached = /** @type {Record<string, unknown>} */ (JSON.parse(raw));
		if (cached.ok === false) return null;
		const cachedMessage =
			typeof cached.agent_message === 'string'
				? cached.agent_message
				: 'Файл уже подготовлен к скачиванию.';
		return {
			ok: true,
			action: typeof cached.action === 'string' ? cached.action : 'download',
			document_id: cached.document_id,
			directory_id: cached.directory_id ?? directoryId,
			name: pickString(cached.name, cached.file_name) || fileName,
			file_name: pickString(cached.file_name, cached.name) || fileName,
			content_type: cached.content_type,
			size_bytes: cached.size_bytes,
			content_base64: cached.content_base64,
			content_base64_present: cached.content_base64_present,
			deliverable: cached.deliverable,
			delivery_method: cached.delivery_method,
			download_ready: cached.download_ready,
			download_status: cached.download_status,
			show_download_widget: cached.show_download_widget,
			feedback_prompt_ok: cached.feedback_prompt_ok,
			feedback_prompt_retry: cached.feedback_prompt_retry,
			already_completed: true,
			download_fresh: false,
			do_not_retry: true,
			agent_stop: true,
			forbid_followup_tools: Array.isArray(cached.forbid_followup_tools)
				? cached.forbid_followup_tools
				: ['r7_disk_download', 'download', 'r7_disk_document'],
			agent_message: cachedMessage.includes('повтор')
				? cachedMessage
				: `${cachedMessage} Повторный download не нужен.`
		};
	} catch {
		return null;
	}
}

/**
 * @param {string} fileName
 * @returns {string}
 */
function normalizeViewOnlyFileKey(fileName) {
	return fileName.trim().toLowerCase();
}

/**
 * @param {SkillKeyValueStorage | null} skillStorage
 * @param {number} directoryId
 * @param {string} fileName
 * @param {number} documentId
 * @param {Record<string, unknown>} input
 * @returns {(Record<string, unknown> & { ok: boolean }) | null}
 */
function resolveViewOnlyDownloadBlock(skillStorage, directoryId, fileName, documentId, input) {
	if (!skillStorage || input.force_redownload === true || input.force_repeat === true) {
		return null;
	}
	const blockedByDoc =
		documentId != null && skillStorage.get(`r7_disk_view_only_${documentId}`) === '1';
	const blockedByPath =
		skillStorage.get(`r7_disk_view_only_${directoryId}_${normalizeViewOnlyFileKey(fileName)}`) ===
		'1';
	if (!blockedByDoc && !blockedByPath) return null;
	return {
		ok: false,
		error: 'Скачивание не запрашивалось: текст уже получен через read_content.',
		download_not_requested: true,
		document_id: documentId,
		directory_id: directoryId,
		name: fileName,
		file_name: fileName,
		do_not_retry: true,
		agent_stop: true,
		use_tool: 'none',
		agent_message:
			`Пользователь просил показать текст «${fileName}», не скачивать. ` +
			'Текст уже в карточке documentContentCard и в log_text_preview предыдущего read_content — не вызывайте r7_disk_download.',
		forbid_followup_tools: [
			'r7_disk_download',
			'download',
			'r7_disk_document',
			'read_content',
			'r7_disk_list_directory',
			'list_directory'
		]
	};
}

/**
 * @param {SkillKeyValueStorage | null} skillStorage
 * @param {number} directoryId
 * @param {string} fileName
 * @param {Record<string, unknown>} result
 */
function persistDownloadDedup(skillStorage, directoryId, fileName, result) {
	if (!skillStorage || result.ok === false) return;
	skillStorage.set(
		buildDownloadDedupKey(directoryId, fileName),
		JSON.stringify({
			ok: true,
			action: 'download',
			document_id: result.document_id,
			directory_id: result.directory_id,
			name: result.name,
			file_name: result.file_name,
			content_type: result.content_type,
			size_bytes: result.size_bytes,
			content_base64: result.content_base64,
			content_base64_present: result.content_base64_present,
			deliverable: result.deliverable,
			delivery_method: result.delivery_method,
			download_ready: result.download_ready,
			download_status: result.download_status,
			show_download_widget: result.show_download_widget,
			feedback_prompt_ok: result.feedback_prompt_ok,
			feedback_prompt_retry: result.feedback_prompt_retry,
			agent_message: result.agent_message,
			forbid_followup_tools: result.forbid_followup_tools,
			at: Date.now()
		})
	);
}

/**
 * @param {unknown} raw
 * @param {Record<string, unknown>} [state]
 * @returns {Record<string, unknown>}
 */
function normalizeParams(raw, state) {
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
				base = { .../** @type {Record<string, unknown>} */ (nested), ...base };
			}
		}
	}

	try {
		const globalInput = globalThis['input'];
		if (globalInput && typeof globalInput === 'object' && !Array.isArray(globalInput)) {
			if (Object.keys(base).length === 0) {
				base = { .../** @type {Record<string, unknown>} */ (globalInput) };
			}
		}
	} catch {
		/* ignore */
	}

	return base;
}

/**
 * @param {string} baseUrl
 * @param {string} authToken
 * @param {number} directoryId
 * @param {string} requestedName
 * @returns {Promise<Record<string, unknown> & { ok: boolean }>}
 */
async function findDocumentInDirectory(baseUrl, authToken, directoryId, requestedName) {
	const docs = await fetchDirectoryDocuments(baseUrl, authToken, directoryId);
	const trimmed = requestedName.trim().toLowerCase();
	/** @type {Array<Record<string, unknown>>} */
	const matches = [];
	for (const doc of docs) {
		const name = typeof doc.Name === 'string' ? doc.Name.trim() : '';
		if (!name) continue;
		if (name.toLowerCase() === trimmed) matches.push(doc);
		else if (!trimmed.includes('.') && name.toLowerCase().startsWith(`${trimmed}.`)) {
			matches.push(doc);
		}
	}
	if (matches.length === 0) {
		return {
			ok: false,
			error: `Файл «${requestedName}» не найден в папке id=${directoryId}.`,
			directory_id: directoryId,
			name: requestedName
		};
	}
	const picked = matches.sort((a, b) => {
		const aId = typeof a.Id === 'number' ? a.Id : 0;
		const bId = typeof b.Id === 'number' ? b.Id : 0;
		return bId - aId;
	})[0];
	const documentId = typeof picked.Id === 'number' ? picked.Id : null;
	const fileName = typeof picked.Name === 'string' ? picked.Name.trim() : requestedName;
	if (documentId == null) {
		return { ok: false, error: 'Не удалось определить document_id файла.' };
	}
	return { ok: true, document_id: documentId, file_name: fileName };
}

/**
 * @param {string} baseUrl
 * @param {string} authToken
 * @param {number} directoryId
 */
async function fetchDirectoryDocuments(baseUrl, authToken, directoryId) {
	const url = `${baseUrl}/api/v1/DocumentDirectory/Get?id=${encodeURIComponent(String(directoryId))}`;
	let response;
	try {
		response = await fetch(url, {
			method: 'GET',
			headers: { 'Content-Type': 'application/json', Authorization: authToken }
		});
	} catch {
		return [];
	}
	if (!response.ok) return [];
	const rawText = await readUtf8Text(response);
	try {
		const payload = rawText ? JSON.parse(rawText) : [];
		const entries = Array.isArray(payload) ? payload : [payload];
		const entry = entries.find((item) => item && typeof item === 'object') ?? entries[0];
		if (!entry || typeof entry !== 'object') return [];
		const rawDocs = Array.isArray(entry.Documents)
			? entry.Documents.filter((item) => item && typeof item === 'object')
			: [];
		return rawDocs.filter((doc) => {
			const docDirId = typeof doc.DirectoryId === 'number' ? doc.DirectoryId : null;
			return docDirId == null || docDirId === directoryId;
		});
	} catch {
		return [];
	}
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

	if (!login || !password) {
		return {
			ok: false,
			error: 'Нет токена. Сначала вызовите r7_disk_login или задайте R7_DISK_LOGIN/R7_DISK_PASSWORD.'
		};
	}

	const response = await fetch(`${baseUrl}/api/v2/auth/Login`, {
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
	const token = payload?.Response?.Data?.Tokens?.AuthToken;
	if (typeof token !== 'string' || !token) {
		return { ok: false, error: 'Login: AuthToken не найден.' };
	}
	if (skillStorage) {
		skillStorage.set('r7_disk_auth_token', token);
		skillStorage.set('r7_disk_base_url', baseUrl);
	}
	return { ok: true, auth_token: token };
}

/**
 * @param {number} documentId
 * @param {string} fileName
 */
function buildFeedbackPrompts(documentId, fileName) {
	return {
		feedback_prompt_ok: `Скачивание «${fileName}» (document_id=${documentId}) прошло успешно.`,
		feedback_prompt_retry: `Не удалось скачать «${fileName}». Повтори r7_disk_download: directory_id и name.`
	};
}

/**
 * @param {Record<string, unknown>} state
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
 * @param {Record<string, unknown>} params
 * @param {SkillKeyValueStorage | null} skillStorage
 */
function resolveBaseUrl(state, params, skillStorage) {
	const userEnv = readUserEnv(state);
	const fromParam = typeof params.base_url === 'string' ? params.base_url.trim() : '';
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
 * @returns {number | null}
 */
function parsePositiveId(value) {
	if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
		return Math.trunc(value);
	}
	if (typeof value === 'string' && value.trim()) {
		const n = Number(value.trim());
		if (Number.isFinite(n) && n > 0) return Math.trunc(n);
	}
	return null;
}

/**
 * @param {unknown} primary
 * @param {unknown} fallback
 */
function pickString(primary, fallback) {
	if (typeof primary === 'string' && primary.trim()) return primary.trim();
	if (typeof fallback === 'string' && fallback.trim()) return fallback.trim();
	return '';
}

/**
 * @param {{ text: () => Promise<string> }} response
 */
async function readUtf8Text(response) {
	return response.text();
}

/**
 * @param {Uint8Array} bytes
 */
function encodeBase64(bytes) {
	let binary = '';
	for (let i = 0; i < bytes.length; i++) {
		binary += String.fromCharCode(bytes[i]);
	}
	return btoa(binary);
}

/**
 * @param {unknown} value
 */
function errorMessage(value) {
	return value instanceof Error ? value.message : String(value);
}

/**
 * @param {string} text
 * @param {number} max
 */
function truncate(text, max) {
	if (text.length <= max) return text;
	return `${text.slice(0, max)}…`;
}

/**
 * @typedef {Object} SkillKeyValueStorage
 * @property {(key: string) => unknown} get
 * @property {(key: string, value: string) => void} set
 */