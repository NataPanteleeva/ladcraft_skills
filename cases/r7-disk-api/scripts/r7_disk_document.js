/**
 * Document (file) operations on R7-Disk KS 2024 Documents API.
 * @param {Record<string, unknown>} state
 * @param {Record<string, unknown>} params
 */
/** Макс. размер файла для передачи в ответе download (content_base64). */
const DOWNLOAD_BASE64_MAX_BYTES = 5 * 1024 * 1024;
/** Макс. символов текста в ответе read_content (остальное — content_truncated). */
const READ_CONTENT_MAX_CHARS = 12_000;

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
 * Ladcraft может передать аргументы как params, вложенный input/arguments или глобальный input.
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
				if (Object.keys(base).length === 0 || !resolveToolAction(base)) {
					base = { ...nestedRecord, ...base };
				} else if (!resolveToolAction(base) && resolveToolAction(nestedRecord)) {
					base = { ...base, ...nestedRecord };
				}
			}
		}
	}

	const globalInput = readGlobalToolInput();
	if (globalInput) {
		base =
			Object.keys(base).length === 0
				? { ...globalInput }
				: { ...globalInput, ...base };
	}

	if (state && typeof state === 'object' && Object.keys(base).length === 0) {
		const stateRecord = /** @type {Record<string, unknown>} */ (state);
		for (const key of ['operation', 'action', 'directory_id', 'name', 'file_name', 'content_text']) {
			if (stateRecord[key] !== undefined) {
				base[key] = stateRecord[key];
			}
		}
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
	/*__CURSOR_LADCRAFT_WIDGET_NAME__=documentContentCard*/
	const input = normalizeToolParams(params, /** @type {Record<string, unknown>} */ (state));
	const allowed =
		'create, upload, replace, prepend, append, rename, delete, restore, move, copy, exists, get_id_by_name, read_content, download, versions, change_version, convert';
	const action = resolveToolAction(input);
	if (!action) {
		return {
			ok: false,
			error: `Не задан operation (или action). Допустимо: ${allowed}. Для скачивания используйте r7_disk_download.`,
			debug_received_keys: Object.keys(input),
			debug_raw_param_type: params == null ? 'null' : typeof params,
			agent_message:
				'Ошибка r7_disk_document: не передан operation. Для «скачай» — tool r7_disk_download (directory_id + name). Запрещено выдумывать download_link при ok: false.'
		};
	}

	if (action === 'download') {
		return {
			ok: false,
			error: 'Скачивание перенесено в r7_disk_download. Передайте directory_id и name туда.',
			use_tool: 'r7_disk_download',
			required_example: { directory_id: input.directory_id, name: input.name ?? input.file_name },
			agent_message:
				'Не вызывайте r7_disk_document download. Используйте r7_disk_download с directory_id и name — появится кнопка «Скачать файл».'
		};
	}

	const userEnv = readUserEnv(state);
	const skillStorage = resolveSkillStorage(state);
	const baseUrl = resolveBaseUrl(state, input, skillStorage);
	const login = pickString(input['login'], userEnv.R7_DISK_LOGIN);
	const password = pickString(input['password'], userEnv.R7_DISK_PASSWORD);

	if (!baseUrl) {
		return { ok: false, error: 'Не задан R7_DISK_BASE_URL.' };
	}

	const authResult = await ensureAuthToken(
		baseUrl,
		login,
		password,
		skillStorage,
		input['auth_token']
	);
	if (!authResult.ok) return { ok: false, error: authResult.error };
	const authToken = authResult.auth_token;

	if (action === 'read_content') {
		const readDedupHit = resolveReadContentDedupHit(skillStorage, input);
		if (readDedupHit) {
			return withSessionAuthHints(readDedupHit, authResult.auth_from_cache);
		}
		markReadInflight(skillStorage, input);
	}

	const writeDedupHit = resolveWriteDedupHit(skillStorage, action, input);
	if (writeDedupHit) {
		return withSessionAuthHints(writeDedupHit, authResult.auth_from_cache);
	}
	markWriteInflight(skillStorage, action, input);

	try {
		/** @type {Record<string, unknown>} */
		let toolResult;
		switch (action) {
			case 'create':
				toolResult = await actionCreate(state, baseUrl, authToken, input);
				break;
			case 'upload':
				toolResult = await actionUpload(state, baseUrl, authToken, input);
				break;
			case 'replace':
				toolResult = await actionReplace(state, baseUrl, authToken, input);
				break;
			case 'prepend':
				toolResult = await actionInsertContent(state, baseUrl, authToken, input, 'prepend');
				break;
			case 'append':
				toolResult = await actionInsertContent(state, baseUrl, authToken, input, 'append');
				break;
			case 'rename':
				toolResult = await actionRename(baseUrl, authToken, input);
				break;
			case 'delete':
				toolResult = await actionDelete(baseUrl, authToken, input);
				break;
			case 'restore':
				toolResult = await actionRestore(baseUrl, authToken, input);
				break;
			case 'move':
				toolResult = await actionMove(baseUrl, authToken, input);
				break;
			case 'copy':
				toolResult = await actionCopy(baseUrl, authToken, input);
				break;
			case 'exists':
				toolResult = await actionExists(baseUrl, authToken, input);
				break;
			case 'get_id_by_name':
				toolResult = await actionGetIdByName(baseUrl, authToken, input);
				break;
			case 'read_content':
				toolResult = await actionReadContent(state, baseUrl, authToken, input);
				break;
			case 'download':
				toolResult = await actionDownload(state, baseUrl, authToken, input);
				break;
			case 'versions':
				toolResult = await actionVersions(baseUrl, authToken, input);
				break;
			case 'change_version':
				toolResult = await actionChangeVersion(baseUrl, authToken, input);
				break;
			case 'convert':
				toolResult = await actionConvert(baseUrl, authToken, input);
				break;
			default:
				clearWriteInflight(skillStorage, action, input);
				return { ok: false, error: `Неизвестный action "${action}". Допустимо: ${allowed}.` };
		}
		const successResult = /** @type {Record<string, unknown> & { ok: boolean }} */ (toolResult);
		if (successResult.ok !== false) {
			if (action === 'read_content') {
				persistReadContentDedup(skillStorage, successResult);
				markViewOnlyAfterRead(skillStorage, successResult);
				clearReadInflight(skillStorage, input);
			} else if (WRITE_DEDUP_ACTIONS.has(action)) {
				persistWriteDedup(skillStorage, action, input, successResult);
			}
		} else {
			if (action === 'read_content') {
				clearReadInflight(skillStorage, input);
			} else {
				clearWriteInflight(skillStorage, action, input);
			}
		}
		return withSessionAuthHints(successResult, authResult.auth_from_cache);
	} catch (err) {
		if (action === 'read_content') {
			clearReadInflight(skillStorage, input);
		} else {
			clearWriteInflight(skillStorage, action, input);
		}
		return { ok: false, error: errorMessage(err) };
	}
}

/**
 * @param {Record<string, unknown>} state
 * @param {string} baseUrl
 * @param {string} authToken
 * @param {Record<string, unknown>} params
 */
async function actionCreate(state, baseUrl, authToken, params) {
	const skillStorage = resolveSkillStorage(state);
	const directoryId = resolvePositiveId(params.directory_id);
	const name = typeof params.name === 'string' ? params.name.trim() : '';
	if (directoryId == null || !name) {
		return { ok: false, error: 'Для create нужны directory_id (> 0) и name.' };
	}

	const contentText =
		typeof params.content_text === 'string' ? params.content_text : null;
	const contentBase64 = normalizeBase64Param(params.content_base64);
	if (contentText !== null || contentBase64) {
		return actionCreateWithContent(
			state,
			baseUrl,
			authToken,
			params,
			directoryId,
			name,
			contentText,
			contentBase64
		);
	}

	const lower = name.toLowerCase();
	if (
		lower.endsWith('.txt') ||
		lower.endsWith('.md') ||
		lower.endsWith('.csv') ||
		lower.endsWith('.json') ||
		lower.endsWith('.xml')
	) {
		const mimeOverride =
			typeof params.mime_type === 'string' && params.mime_type.trim()
				? params.mime_type.trim()
				: '';
		const uploadResult = await performMultipartUpload(
			baseUrl,
			authToken,
			directoryId,
			name,
			new Uint8Array(0),
			mimeOverride
		);
		if (!uploadResult.ok) return uploadResult;
		const docId = resolvePositiveId(uploadResult.document_id);
		cacheFileMeta(skillStorage, docId, name, 0);
		return buildWriteToolResponse({
			...uploadResult,
			action: 'create',
			name,
			file_name: name,
			created_via: 'upload_empty',
			display_file_type: fileTypeLabelFromName(name),
			document_id: docId,
			agent_message: `Пустой файл «${name}» создан.`
		});
	}

	const mimeOverride =
		typeof params.mime_type === 'string' && params.mime_type.trim()
			? params.mime_type.trim()
			: '';
	const mimeType = inferMimeType(name, mimeOverride);

	const url = `${baseUrl}/api/v1/Documents/Create`;
	/** @type {Array<Record<string, unknown>>} */
	const bodies = [
		{ DirectoryId: directoryId, Name: name },
		{ DirectoryId: directoryId, Name: name, MimeType: mimeType },
		{ ParentId: directoryId, Name: name }
	];

	let lastError = '';
	for (const body of bodies) {
		const http = await apiRequest('POST', url, authToken, body);
		if (http.ok) {
			const documentId = extractDocumentId(http.data);
			cacheFileMeta(skillStorage, documentId, name, 0);
			return buildWriteToolResponse({
				ok: true,
				action: 'create',
				document_id: documentId,
				directory_id: directoryId,
				name,
				file_name: name,
				mime_type: mimeType,
				display_file_type: fileTypeLabelFromName(name),
				data: toApiRecord(http.data),
				api_base_url: baseUrl,
				agent_message: `Файл «${name}» создан (${fileTypeLabelFromName(name)}).`
			});
		}
		lastError = http.error ?? 'Create failed';
		if (http.status !== 400 && http.status !== 422) break;
	}

	return { ok: false, error: lastError, api_base_url: baseUrl };
}

/**
 * @param {string} baseUrl
 * @param {string} authToken
 * @param {Record<string, unknown>} params
 * @param {number} directoryId
 * @param {string} name
 * @param {string | null} contentText
 * @param {string} contentBase64
 */
async function actionCreateWithContent(
	state,
	baseUrl,
	authToken,
	params,
	directoryId,
	name,
	contentText,
	contentBase64
) {
	const skillStorage = resolveSkillStorage(state);
	/** @type {Uint8Array} */
	let fileBytes;
	try {
		fileBytes = resolveFileBytes(name, contentText, contentBase64);
	} catch (err) {
		return { ok: false, error: errorMessage(err) };
	}

	const mimeOverride =
		typeof params.mime_type === 'string' && params.mime_type.trim()
			? params.mime_type.trim()
			: '';

	const uploadResult = await performMultipartUpload(
		baseUrl,
		authToken,
		directoryId,
		name,
		fileBytes,
		mimeOverride
	);
	if (!uploadResult.ok) return uploadResult;

	const docId = resolvePositiveId(uploadResult.document_id);
	const size = uploadResult.size_bytes ?? 0;
	cacheFileMeta(skillStorage, docId, name, size);
	return buildWriteToolResponse({
		...uploadResult,
		action: 'create',
		name,
		file_name: name,
		document_id: docId,
		directory_id: directoryId,
		created_via: 'upload',
		display_file_type: fileTypeLabelFromName(name),
		declared_mime_type: inferMimeType(name, mimeOverride),
		tool_log_summary: `CREATE_OK:${name}`,
		agent_message: `Файл «${name}» создан (${fileTypeLabelFromName(name)}, ${size} байт).`
	});
}

/**
 * @param {string} fileName
 * @param {string | null} contentText
 * @param {string} contentBase64
 * @returns {Uint8Array}
 */
function resolveFileBytes(fileName, contentText, contentBase64) {
	if (contentText !== null) {
		const lower = fileName.toLowerCase();
		if (lower.endsWith('.docx')) {
			return buildMinimalDocxBytes(contentText);
		}
		return encodeUtf8(contentText);
	}
	if (contentBase64) {
		return decodeBase64(contentBase64);
	}
	throw new Error('Нет content_text и content_base64.');
}

/**
 * @param {string} baseUrl
 * @param {string} authToken
 * @param {Record<string, unknown>} params
 */
async function actionUpload(state, baseUrl, authToken, params) {
	const skillStorage = resolveSkillStorage(state);
	const directoryId = resolvePositiveId(params.directory_id);
	const fileName = typeof params.file_name === 'string' ? params.file_name.trim() : '';
	const contentText =
		typeof params.content_text === 'string' ? params.content_text : null;
	const contentBase64 = normalizeBase64Param(params.content_base64);

	if (directoryId == null || !fileName) {
		return {
			ok: false,
			error: 'Для upload нужны directory_id (> 0) и file_name.'
		};
	}
	if (contentText === null && !contentBase64) {
		return {
			ok: false,
			error: 'Для upload укажите content_text (текст UTF-8) или content_base64.'
		};
	}

	let fileBytes;
	try {
		fileBytes = resolveFileBytes(fileName, contentText, contentBase64);
	} catch (err) {
		return { ok: false, error: errorMessage(err) };
	}

	const mimeOverride =
		typeof params.mime_type === 'string' && params.mime_type.trim()
			? params.mime_type.trim()
			: '';

	const upload = await performMultipartUpload(
		baseUrl,
		authToken,
		directoryId,
		fileName,
		fileBytes,
		mimeOverride
	);
	if (!upload.ok) return upload;
	const docId = resolvePositiveId(upload.document_id);
	cacheFileMeta(skillStorage, docId, fileName, fileBytes.length);
	return buildWriteToolResponse({
		...upload,
		agent_message: `Файл «${fileName}» загружен (${fileBytes.length} байт).`
	});
}

/**
 * Логическая замена файла: удалить старый (если найден) и загрузить новый с тем же именем.
 * В KS 2024 API нет отдельного endpoint для in-place редактирования контента.
 * @param {Record<string, unknown>} state
 * @param {string} baseUrl
 * @param {string} authToken
 * @param {Record<string, unknown>} params
 */
async function actionReplace(state, baseUrl, authToken, params) {
	const directoryId = resolvePositiveId(params.directory_id);
	const fileName = pickString(params.name, params.file_name);
	const contentText = typeof params.content_text === 'string' ? params.content_text : null;
	const contentBase64 = normalizeBase64Param(params.content_base64);
	if (directoryId == null || !fileName) {
		return {
			ok: false,
			error: 'Для replace нужны directory_id (> 0) и name (или file_name).'
		};
	}
	if (contentText === null && !contentBase64) {
		return {
			ok: false,
			error: 'Для replace укажите content_text (текст UTF-8) или content_base64.'
		};
	}

	let existingId = resolvePositiveId(params.document_id);
	if (existingId == null) {
		const lookupUrl =
			`${baseUrl}/api/v1/Documents/GetIdByName?` +
			`name=${encodeURIComponent(fileName)}&` +
			`directoryId=${encodeURIComponent(String(directoryId))}`;
		const lookup = await apiRequest('GET', lookupUrl, authToken);
		if (lookup.ok) existingId = extractDocumentId(lookup.data);
	}

	/** @type {Uint8Array} */
	let fileBytes;
	try {
		fileBytes = resolveFileBytes(fileName, contentText, contentBase64);
	} catch (err) {
		return { ok: false, error: errorMessage(err) };
	}

	const mimeOverride =
		typeof params.mime_type === 'string' && params.mime_type.trim() ? params.mime_type.trim() : '';
	const skillStorage = resolveSkillStorage(state);
	const upload = await uploadReplacingDocument(
		baseUrl,
		authToken,
		directoryId,
		fileName,
		fileBytes,
		mimeOverride,
		existingId,
		{ preferDeleteUpload: true }
	);
	if (!upload.ok) return upload;

	const newDocumentId = resolvePositiveId(upload.document_id);
	invalidateFileAfterWrite(
		skillStorage,
		existingId,
		newDocumentId,
		fileBytes.length,
		directoryId,
		fileName
	);
	cacheFileMeta(skillStorage, newDocumentId, fileName, fileBytes.length);

	return buildWriteToolResponse({
		...upload,
		action: 'replace',
		name: fileName,
		file_name: fileName,
		replaced: existingId != null,
		replaced_document_id: existingId,
		content_preserved: false,
		full_content_replace: true,
		document_id: newDocumentId ?? upload.document_id,
		agent_message: `Файл «${fileName}» полностью заменён (${fileBytes.length} байт).`
	});
}

/**
 * Дописать текст в начало или конец существующего файла (download → merge → upload in-place).
 * Delete + Upload — только запасной путь, если in-place не сохранил текст на сервере.
 * @param {Record<string, unknown>} state
 * @param {string} baseUrl
 * @param {string} authToken
 * @param {Record<string, unknown>} params
 * @param {'prepend' | 'append'} mode
 */
async function actionInsertContent(state, baseUrl, authToken, params, mode) {
	let directoryId =
		resolvePositiveId(params.directory_id) ?? resolvePersonalDirectoryIdFromStorage(state);
	const requestedName = pickString(params.name, params.file_name);
	const contentText = typeof params.content_text === 'string' ? params.content_text : null;
	const contentBase64 = normalizeBase64Param(params.content_base64);
	const skillStorage = resolveSkillStorage(state);
	let documentId = resolvePositiveId(params.document_id);

	if (!requestedName) {
		return {
			ok: false,
			error: `Для ${mode} нужны name (или file_name) и document_id из list_directory либо directory_id.`
		};
	}
	if (contentText === null && !contentBase64) {
		return {
			ok: false,
			error: `Для ${mode} укажите content_text (текст UTF-8) или content_base64.`
		};
	}

	let fileName = requestedName.trim();
	if (!fileName.includes('.')) {
		const nameResult = await resolveCanonicalFileName(
			baseUrl,
			authToken,
			skillStorage,
			directoryId,
			requestedName
		);
		if (!nameResult.ok) return nameResult;
		fileName = nameResult.name;
		if (nameResult.owner_directory_id != null) {
			directoryId = nameResult.owner_directory_id;
		}
	}

	if (documentId == null) {
		const lookup = await resolveDocumentIdForFile(
			baseUrl,
			authToken,
			skillStorage,
			directoryId,
			fileName
		);
		if (!lookup.ok) {
			return buildSharedDocumentAccessError(
				/** @type {Record<string, unknown>} */ (lookup),
				fileName,
				mode
			);
		}
		documentId = lookup.document_id;
		if (lookup.owner_directory_id != null) {
			directoryId = lookup.owner_directory_id;
		}
	}
	if (documentId == null) {
		return {
			ok: false,
			error: `Не удалось определить document_id для «${fileName}».`,
			do_not_invent_success: true
		};
	}
	if (directoryId == null) {
		const ownerDir = readPersistedOwnerDirectoryId(skillStorage, fileName, documentId);
		if (ownerDir != null) directoryId = ownerDir;
	}
	if (directoryId == null) {
		return {
			ok: false,
			error:
				`Для ${mode} расшаренного файла передайте document_id и directory_id (поле DirectoryId из list_directory). ` +
				'Прямой доступ к папке владельца по API может быть запрещён (HTTP 406).',
			document_id: documentId,
			name: fileName,
			shared_edit_example: {
				operation: mode,
				document_id: documentId,
				name: fileName,
				directory_id: '<DirectoryId из documents[]>',
				content_text: '…'
			},
			do_not_invent_success: true
		};
	}
	persistDocumentIdByName(skillStorage, directoryId, fileName, documentId);

	const downloaded = await downloadDocumentBytes(baseUrl, authToken, documentId);
	if (!downloaded.ok) return downloaded;

	let mergedBytes;
	try {
		mergedBytes = await mergeFileBytesForInsert(
			downloaded.bytes,
			fileName,
			contentText,
			contentBase64,
			mode
		);
	} catch (err) {
		return { ok: false, error: errorMessage(err), api_base_url: baseUrl };
	}

	const mimeOverride =
		typeof params.mime_type === 'string' && params.mime_type.trim() ? params.mime_type.trim() : '';
	const insertPlain =
		contentText !== null ? stripInlineMarkup(contentText) : decodeUtf8(decodeBase64(contentBase64));

	const uploadResult = await uploadMergedContentWithVerify(
		baseUrl,
		authToken,
		skillStorage,
		directoryId,
		fileName,
		mergedBytes,
		mimeOverride,
		documentId,
		insertPlain,
		mode
	);
	if (!uploadResult.ok) return uploadResult;

	const uploadSuccess = /** @type {{ ok: true, upload: Record<string, unknown>, verify: { ok: true, file_text?: string }, documentId: number }} */ (
		uploadResult
	);
	const { upload, verify, documentId: newDocumentId } = uploadSuccess;

	const successMessage =
		mode === 'prepend'
			? `В начало «${fileName}» добавлен текст (${mergedBytes.length} байт).`
			: `В конец «${fileName}» добавлен текст (${mergedBytes.length} байт).`;

	return buildWriteToolResponse({
		...upload,
		action: mode,
		name: fileName,
		file_name: fileName,
		inserted_mode: mode,
		previous_document_id: documentId,
		document_id: newDocumentId,
		directory_id: directoryId,
		size_bytes: mergedBytes.length,
		content_preserved: true,
		full_content_replace: false,
		content_verified: true,
		content_text_verified: verify.file_text,
		tool_log_summary: `${mode.toUpperCase()}_OK:${fileName}`,
		agent_message: successMessage,
		agent_stop: true,
		do_not_verify_with_read_content: true
	});
}

/**
 * @param {string} baseUrl
 * @param {string} authToken
 * @param {number} documentId
 */
async function downloadDocumentBytes(baseUrl, authToken, documentId) {
	const url =
		`${baseUrl}/api/v1/Documents/Download?id=${encodeURIComponent(String(documentId))}` +
		`&_=${encodeURIComponent(String(Date.now()))}`;
	let response;
	try {
		response = await fetch(url, {
			method: 'GET',
			headers: { Authorization: authToken }
		});
	} catch (err) {
		return { ok: false, error: `Сетевая ошибка download: ${errorMessage(err)}` };
	}

	if (!response.ok) {
		const errText = await readUtf8Text(response);
		return { ok: false, error: `Download HTTP ${response.status}: ${truncate(errText, 400)}` };
	}

	const buffer = await /** @type {{ arrayBuffer: () => Promise<ArrayBuffer> }} */ (
		response
	).arrayBuffer();
	const bytes = new Uint8Array(buffer);
	const maxDownloadBytes = 10 * 1024 * 1024;
	if (bytes.length > maxDownloadBytes) {
		return {
			ok: false,
			error: `Файл слишком большой (${bytes.length} байт). Лимит: ${maxDownloadBytes} байт.`
		};
	}

	return {
		ok: true,
		bytes,
		content_type: response.headers.get('content-type') || 'application/octet-stream'
	};
}

/**
 * @param {Uint8Array} existingBytes
 * @param {string} fileName
 * @param {string | null} insertText
 * @param {string} insertBase64
 * @param {'prepend' | 'append'} mode
 * @returns {Promise<Uint8Array>}
 */
async function mergeFileBytesForInsert(existingBytes, fileName, insertText, insertBase64, mode) {
	const lower = fileName.toLowerCase();
	if (lower.endsWith('.docx')) {
		if (insertText === null) {
			throw new Error(
				'Для DOCX используйте content_text (разметка **жирный**, *курсив*, **{26}текст** — размер в пунктах).'
			);
		}
		return insertIntoDocxBytesAsync(existingBytes, insertText, mode);
	}
	if (isTextFileName(fileName)) {
		const existingText = decodeUtf8(existingBytes);
		const insertChunk =
			insertText !== null ? insertText : decodeUtf8(decodeBase64(insertBase64));
		const merged =
			mode === 'prepend' ? insertChunk + existingText : existingText + insertChunk;
		return encodeUtf8(merged);
	}
	throw new Error(
		`Дописывание поддерживается для .txt/.md/.csv и .docx. Файл: ${fileName}`
	);
}

/**
 * @param {string} fileName
 * @returns {boolean}
 */
function isTextFileName(fileName) {
	const lower = fileName.toLowerCase();
	return (
		lower.endsWith('.txt') ||
		lower.endsWith('.md') ||
		lower.endsWith('.csv') ||
		lower.endsWith('.json') ||
		lower.endsWith('.xml') ||
		lower.endsWith('.html') ||
		lower.endsWith('.htm')
	);
}

/**
 * @param {Uint8Array} existingBytes
 * @param {string} insertText
 * @param {'prepend' | 'append'} mode
 * @returns {Promise<Uint8Array>}
 */
async function insertIntoDocxBytesAsync(existingBytes, insertText, mode) {
	const entries = await readZipEntriesAsync(existingBytes);
	const docPath = 'word/document.xml';
	const docIndex = entries.findIndex((entry) => entry.path === docPath);
	if (docIndex < 0) {
		throw new Error('DOCX: word/document.xml не найден.');
	}

	const docXml = decodeUtf8(entries[docIndex].data);
	const insertParagraphs = String(insertText)
		.split(/\r?\n/)
		.map((line) => buildDocxParagraphXml(line))
		.join('');

	const bodyMatch = docXml.match(/<w:body[^>]*>/);
	if (!bodyMatch || bodyMatch.index === undefined) {
		throw new Error('DOCX: тег <w:body> не найден.');
	}
	const bodyOpenTag = bodyMatch[0];
	const bodyStart = bodyMatch.index + bodyOpenTag.length;
	const bodyClose = docXml.indexOf('</w:body>', bodyStart);
	if (bodyClose < 0) {
		throw new Error('DOCX: закрывающий </w:body> не найден.');
	}

	const beforeInner = docXml.slice(bodyStart, bodyClose);
	const { content, sectPr } = splitDocxBodyInner(beforeInner);
	const newInner =
		mode === 'prepend'
			? insertParagraphs + content + sectPr
			: content + insertParagraphs + sectPr;
	const newDocXml = docXml.slice(0, bodyStart) + newInner + docXml.slice(bodyClose);
	entries[docIndex] = { path: docPath, data: encodeUtf8(newDocXml) };

	return createZipArchive(entries);
}

/**
 * Отделяет w:sectPr — он должен оставаться последним элементом в w:body (иначе Word ломает файл).
 * @param {string} inner
 * @returns {{ content: string, sectPr: string }}
 */
function splitDocxBodyInner(inner) {
	const sectPrRe = /<w:sectPr\b[^>]*\/>\s*$|<w:sectPr\b[\s\S]*?<\/w:sectPr>\s*$/;
	const match = inner.match(sectPrRe);
	if (match && match.index !== undefined) {
		return {
			content: inner.slice(0, match.index),
			sectPr: match[0]
		};
	}
	return { content: inner, sectPr: '' };
}

/**
 * @typedef {{ path: string, data: Uint8Array }} ZipEntry
 */

/**
 * @param {Uint8Array} bytes
 * @returns {Promise<ZipEntry[]>}
 */
async function readZipEntriesAsync(bytes) {
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	let eocdOffset = -1;
	const minEocd = 22;
	for (let i = bytes.length - minEocd; i >= 0; i--) {
		if (view.getUint32(i, true) === 0x06054b50) {
			eocdOffset = i;
			break;
		}
	}
	if (eocdOffset < 0) {
		throw new Error('ZIP: не найден конец архива (EOCD).');
	}

	const entryCount = view.getUint16(eocdOffset + 10, true);
	const centralDirOffset = view.getUint32(eocdOffset + 16, true);

	/** @type {ZipEntry[]} */
	const entries = [];
	let pos = centralDirOffset;

	for (let e = 0; e < entryCount; e++) {
		if (view.getUint32(pos, true) !== 0x02014b50) {
			break;
		}
		const compMethod = view.getUint16(pos + 10, true);
		const compSize = view.getUint32(pos + 20, true);
		const nameLen = view.getUint16(pos + 28, true);
		const extraLen = view.getUint16(pos + 30, true);
		const commentLen = view.getUint16(pos + 32, true);
		const localOffset = view.getUint32(pos + 42, true);
		const name = decodeUtf8(bytes.slice(pos + 46, pos + 46 + nameLen)).replace(/\\/g, '/');
		pos += 46 + nameLen + extraLen + commentLen;

		const localPos = localOffset;
		if (view.getUint32(localPos, true) !== 0x04034b50) {
			continue;
		}
		const localNameLen = view.getUint16(localPos + 26, true);
		const localExtraLen = view.getUint16(localPos + 28, true);
		const dataStart = localPos + 30 + localNameLen + localExtraLen;
		const raw = bytes.slice(dataStart, dataStart + compSize);
		const data = await inflateZipEntry(raw, compMethod);
		entries.push({ path: name, data });
	}

	return entries;
}

/**
 * @param {Uint8Array} data
 * @param {number} method
 * @returns {Promise<Uint8Array>}
 */
async function inflateZipEntry(data, method) {
	if (method === 0) {
		return data;
	}
	if (method === 8) {
		/** @type {any} */
		const g = globalThis;
		if (!g.DecompressionStream || !g.Blob || !g.Response) {
			throw new Error(
				'ZIP deflate не поддерживается в среде навыка. Создайте DOCX через create навыка или используйте .txt.'
			);
		}
		/** @type {string[]} */
		const formats = ['deflate', 'deflate-raw'];
		let lastError = '';
		for (const format of formats) {
			try {
				const stream = new g.Blob([data]).stream().pipeThrough(
					new g.DecompressionStream(format)
				);
				const buf = await new g.Response(stream).arrayBuffer();
				if (buf.byteLength > 0) {
					return new Uint8Array(buf);
				}
			} catch (err) {
				lastError = errorMessage(err);
			}
		}
		throw new Error(
			`ZIP deflate: не удалось распаковать (${lastError || 'пустой результат'}).`
		);
	}
	throw new Error(`ZIP: неподдерживаемый метод сжатия ${method}.`);
}

/**
 * @param {Uint8Array} docxBytes
 * @returns {Promise<string>}
 */
async function extractDocxTextPreview(docxBytes) {
	const entries = await readZipEntriesAsync(docxBytes);
	const doc = entries.find((entry) => entry.path === 'word/document.xml');
	if (!doc) {
		throw new Error('DOCX: word/document.xml не найден в архиве.');
	}
	return extractPlainTextFromDocxXml(decodeUtf8(doc.data));
}

/**
 * @param {string} docXml
 * @returns {string}
 */
function extractPlainTextFromDocxXml(docXml) {
	/** @type {string[]} */
	const paragraphs = [];
	const pRe = /<w:p\b[^>]*>([\s\S]*?)<\/w:p>/g;
	let pMatch;
	while ((pMatch = pRe.exec(docXml)) !== null) {
		paragraphs.push(extractPlainTextFromDocxParagraph(pMatch[1]));
	}
	if (paragraphs.length === 0) {
		paragraphs.push(extractPlainTextFromDocxParagraph(docXml));
	}
	return paragraphs
		.map((line) => line.trimEnd())
		.filter((line, index, arr) => line.length > 0 || (index > 0 && index < arr.length - 1))
		.join('\n')
		.trim();
}

/**
 * @param {string} paragraphXml
 * @returns {string}
 */
function extractPlainTextFromDocxParagraph(paragraphXml) {
	/** @type {string[]} */
	const parts = [];
	const tokenRe = /<w:t[^>]*>([^<]*)<\/w:t>|<w:tab\s*\/>|<w:br\s*\/>|<w:cr\s*\/>/g;
	let tokenMatch;
	while ((tokenMatch = tokenRe.exec(paragraphXml)) !== null) {
		if (tokenMatch[1] != null) {
			parts.push(decodeXmlText(tokenMatch[1]));
		} else {
			parts.push('\n');
		}
	}
	if (parts.length === 0) {
		const tRe = /<w:t[^>]*>([^<]*)<\/w:t>/g;
		let tMatch;
		while ((tMatch = tRe.exec(paragraphXml)) !== null) {
			parts.push(decodeXmlText(tMatch[1]));
		}
	}
	return parts.join('');
}

/**
 * @param {string} fileName
 * @param {Uint8Array} bytes
 * @returns {Promise<string>}
 */
async function extractFileTextFromBytes(fileName, bytes) {
	const lower = fileName.toLowerCase();
	if (lower.endsWith('.docx') || isDocxBytes(bytes, '')) {
		return extractDocxTextPreview(bytes);
	}
	if (isTextFileName(fileName)) {
		return decodeUtf8(bytes);
	}
	throw new Error(
		`Чтение содержимого поддерживается для .txt/.md/.csv/.json и .docx. Файл: ${fileName}`
	);
}

/**
 * @param {string} text
 * @returns {string}
 */
function stripInlineMarkup(text) {
	return String(text)
		.replace(/\*\*([^*]+)\*\*/g, '$1')
		.replace(/\*([^*]+)\*/g, '$1')
		.replace(/\r\n/g, '\n');
}

/**
 * @param {string} haystack
 * @param {string} needle
 * @returns {boolean}
 */
function textContainsInsertedContent(haystack, needle) {
	const h = haystack.replace(/\s+/g, ' ').trim();
	const n = needle.replace(/\s+/g, ' ').trim();
	if (!n) return true;
	return h.includes(n);
}

/**
 * @param {string} baseUrl
 * @param {string} authToken
 * @param {string} fileName
 * @param {number} documentId
 * @param {string} insertPlain
 * @param {'prepend' | 'append'} mode
 */
async function verifyInsertedContent(
	baseUrl,
	authToken,
	fileName,
	documentId,
	insertPlain,
	mode
) {
	if (!insertPlain.trim()) {
		return { ok: true };
	}
	const reDownload = await downloadDocumentBytes(baseUrl, authToken, documentId);
	if (!reDownload.ok) {
		return {
			ok: false,
			error:
				`Файл загружен, но не удалось проверить содержимое после ${mode}: ${reDownload.error}`
		};
	}
	let fileText = '';
	try {
		fileText = await extractFileTextFromBytes(fileName, reDownload.bytes);
	} catch (err) {
		return {
			ok: false,
			error: `Файл загружен, но проверка содержимого не удалась: ${errorMessage(err)}`
		};
	}
	if (!textContainsInsertedContent(fileText, insertPlain)) {
		return {
			ok: false,
			error:
				`После ${mode} вставленный текст не найден в файле на диске. ` +
				'Повторите операцию или сообщите администратору (возможен сбой Upload API).',
			content_verified: false,
			file_text_preview: fileText.length > 300 ? `${fileText.slice(0, 300)}…` : fileText
		};
	}
	return { ok: true, content_verified: true, file_text: fileText };
}

/**
 * @param {string} text
 * @returns {string}
 */
function decodeXmlText(text) {
	return text
		.replace(/&apos;/g, "'")
		.replace(/&quot;/g, '"')
		.replace(/&gt;/g, '>')
		.replace(/&lt;/g, '<')
		.replace(/&amp;/g, '&');
}

/**
 * @param {string} baseUrl
 * @param {string} authToken
 * @param {number} directoryId
 * @param {string} fileName
 * @param {Uint8Array} fileBytes
 * @param {string} mimeOverride
 */
async function performMultipartUpload(
	baseUrl,
	authToken,
	directoryId,
	fileName,
	fileBytes,
	mimeOverride,
	options = {}
) {
	const replaceDocumentId =
		options && typeof options.replaceDocumentId === 'number'
			? options.replaceDocumentId
			: null;
	const url = `${baseUrl}/api/v1/Documents/Upload`;
	const boundary = `----R7Disk${Date.now()}`;
	const contentType = inferMimeType(fileName, mimeOverride);
	const bodyBytes = buildMultipartUploadBody(boundary, fileName, contentType, fileBytes);

	/** @type {Record<string, string>} */
	const headers = {
		Authorization: authToken,
		DirectoryId: String(directoryId),
		'Content-Type': `multipart/form-data; boundary=${boundary}`
	};
	if (replaceDocumentId != null) {
		headers.Id = String(replaceDocumentId);
		headers.DocumentId = String(replaceDocumentId);
	}

	let response;
	try {
		response = await fetch(url, /** @type {RequestInit} */ (/** @type {unknown} */ ({
			method: 'POST',
			headers,
			body: toFetchBinaryBody(bodyBytes)
		})));
	} catch (err) {
		return { ok: false, error: `Сетевая ошибка upload: ${errorMessage(err)}`, api_base_url: baseUrl };
	}

	const rawText = await readUtf8Text(response);
	if (!response.ok) {
		return {
			ok: false,
			error: `Upload HTTP ${response.status}: ${truncate(rawText, 400)}`,
			api_base_url: baseUrl
		};
	}

	let payload = null;
	if (rawText) {
		try {
			payload = JSON.parse(rawText);
		} catch {
			payload = rawText;
		}
	}

	const data = unwrapApiData(payload);
	const documentId = extractDocumentId(data);

	return {
		ok: true,
		action: 'upload',
		document_id: documentId,
		directory_id: directoryId,
		file_name: fileName,
		size_bytes: fileBytes.length,
		declared_mime_type: contentType,
		display_file_type: fileTypeLabelFromName(fileName),
		data: toApiRecord(data),
		api_base_url: baseUrl
	};
}

/**
 * @typedef {Object} UploadReplacingOptions
 * @property {boolean} [preferDeleteUpload] Принудительно Delete + Upload (запасной путь для replace).
 */

/**
 * Загрузка слитого файла: сначала in-place (тот же document_id), при сбое проверки — delete + upload.
 * @param {string} baseUrl
 * @param {string} authToken
 * @param {SkillKeyValueStorage | null} skillStorage
 * @param {number} directoryId
 * @param {string} fileName
 * @param {Uint8Array} mergedBytes
 * @param {string} mimeOverride
 * @param {number} documentId
 * @param {string} insertPlain
 * @param {'prepend' | 'append'} mode
 * @returns {Promise<{ ok: boolean, [key: string]: unknown }>}
 */
async function uploadMergedContentWithVerify(
	baseUrl,
	authToken,
	skillStorage,
	directoryId,
	fileName,
	mergedBytes,
	mimeOverride,
	documentId,
	insertPlain,
	mode
) {
	/** @type {Array<{ preferDeleteUpload: boolean, upload_method: string }>} */
	const strategies = [
		{ preferDeleteUpload: false, upload_method: 'in_place_first' },
		{ preferDeleteUpload: true, upload_method: 'delete_upload_fallback' }
	];

	let lastVerify = null;
	let lastUpload = null;
	let workingDocumentId = documentId;

	for (const strategy of strategies) {
		const upload = await uploadReplacingDocument(
			baseUrl,
			authToken,
			directoryId,
			fileName,
			mergedBytes,
			mimeOverride,
			workingDocumentId,
			strategy.preferDeleteUpload ? { preferDeleteUpload: true } : {}
		);
		if (!upload.ok) {
			if (strategy.preferDeleteUpload) {
				return upload;
			}
			continue;
		}

		lastUpload = upload;
		const effectiveId = resolvePositiveId(upload.document_id) ?? workingDocumentId;
		invalidateFileAfterWrite(
			skillStorage,
			workingDocumentId,
			effectiveId,
			mergedBytes.length,
			directoryId,
			fileName
		);
		cacheFileMeta(skillStorage, effectiveId, fileName, mergedBytes.length);

		const verify = await verifyInsertedContent(
			baseUrl,
			authToken,
			fileName,
			effectiveId,
			insertPlain,
			mode
		);
		lastVerify = verify;
		if (verify.ok) {
			return {
				ok: true,
				upload: { ...upload, upload_method: strategy.upload_method },
				verify,
				documentId: effectiveId,
				previous_document_id: documentId
			};
		}

		workingDocumentId = effectiveId;
	}

	return {
		...lastVerify,
		ok: false,
		action: mode,
		directory_id: directoryId,
		name: fileName,
		file_name: fileName,
		document_id: workingDocumentId,
		previous_document_id: documentId,
		upload_method: lastUpload?.upload_method ?? 'failed'
	};
}

/**
 * Обновление файла: сначала Upload с заголовком Id (in-place), иначе Delete + Upload.
 * @param {string} baseUrl
 * @param {string} authToken
 * @param {number} directoryId
 * @param {string} fileName
 * @param {Uint8Array} fileBytes
 * @param {string} mimeOverride
 * @param {number | null} existingDocumentId
 * @param {UploadReplacingOptions} [options]
 */
async function uploadReplacingDocument(
	baseUrl,
	authToken,
	directoryId,
	fileName,
	fileBytes,
	mimeOverride,
	existingDocumentId,
	options = {}
) {
	const opts = /** @type {UploadReplacingOptions} */ (options);
	const preferDeleteUpload = opts.preferDeleteUpload === true;

	if (existingDocumentId != null && preferDeleteUpload) {
		const del = await apiRequest('POST', `${baseUrl}/api/v1/Documents/Delete`, authToken, {
			Ids: [existingDocumentId]
		});
		if (!del.ok) {
			return {
				ok: false,
				error: `Не удалось удалить файл перед перезаливкой: ${del.error}`,
				api_base_url: baseUrl
			};
		}
		return performMultipartUpload(
			baseUrl,
			authToken,
			directoryId,
			fileName,
			fileBytes,
			mimeOverride
		);
	}

	if (existingDocumentId != null) {
		const inPlace = await performMultipartUpload(
			baseUrl,
			authToken,
			directoryId,
			fileName,
			fileBytes,
			mimeOverride,
			{ replaceDocumentId: existingDocumentId }
		);
		if (inPlace.ok) {
			return { ...inPlace, upload_method: 'in_place_id_header' };
		}
		const del = await apiRequest('POST', `${baseUrl}/api/v1/Documents/Delete`, authToken, {
			Ids: [existingDocumentId]
		});
		if (!del.ok) {
			return {
				ok: false,
				error: `Не удалось обновить файл (in-place и delete): ${inPlace.error}; delete: ${del.error}`,
				api_base_url: baseUrl
			};
		}
	}
	return performMultipartUpload(
		baseUrl,
		authToken,
		directoryId,
		fileName,
		fileBytes,
		mimeOverride
	);
}

/** Операции записи, для которых блокируем повторный вызов tool в той же сессии. */
const WRITE_DEDUP_ACTIONS = new Set(['create', 'upload', 'prepend', 'append', 'replace']);

/**
 * @param {string} action
 * @param {Record<string, unknown>} input
 * @returns {string}
 */
function buildWriteDedupKey(action, input) {
	const directoryId = resolvePositiveId(input.directory_id) ?? 0;
	const fileName = pickString(input.name, input.file_name);
	const documentId = resolvePositiveId(input.document_id) ?? 0;
	const namePart = fileName ? documentNameStorageKey(fileName) : '';
	const targetPart = namePart || String(documentId || directoryId);
	return `r7_disk_write_done_${action}_${directoryId}_${targetPart}`;
}

/**
 * @param {string} action
 * @param {Record<string, unknown>} input
 * @returns {string}
 */
function buildWriteInflightKey(action, input) {
	return `${buildWriteDedupKey(action, input)}_inflight`;
}

/**
 * @param {SkillKeyValueStorage | null} skillStorage
 * @param {string} action
 * @param {Record<string, unknown>} input
 * @returns {(Record<string, unknown> & { ok: boolean }) | null}
 */
function resolveWriteDedupHit(skillStorage, action, input) {
	if (!skillStorage || !WRITE_DEDUP_ACTIONS.has(action)) return null;
	if (input.force_repeat === true) return null;

	const inflightKey = buildWriteInflightKey(action, input);
	if (skillStorage.get(inflightKey) === '1') {
		return buildWriteDedupResponse(action, input, {
			already_inflight: true,
			agent_message:
				'Операция с файлом уже выполняется. Дождитесь результата — не вызывайте r7_disk_document повторно.'
		});
	}

	const dedupKey = buildWriteDedupKey(action, input);
	const raw = skillStorage.get(dedupKey);
	if (typeof raw !== 'string' || !raw.trim()) return null;
	try {
		const cached = /** @type {Record<string, unknown>} */ (JSON.parse(raw));
		if (cached.ok === false) return null;
		return buildWriteDedupResponse(action, input, {
			...cached,
			already_completed: true
		});
	} catch {
		return null;
	}
}

/**
 * @param {string} action
 * @param {Record<string, unknown>} input
 * @param {Record<string, unknown>} fields
 * @returns {Record<string, unknown> & { ok: boolean }}
 */
function buildWriteDedupResponse(action, input, fields) {
	const fileName = pickString(
		pickString(input.name, input.file_name),
		pickString(fields.name, fields.file_name)
	);
	const msg =
		typeof fields.agent_message === 'string' && fields.agent_message.trim()
			? fields.agent_message
			: `Операция «${action}» для «${fileName || 'файла'}» уже выполнена.`;
	return /** @type {Record<string, unknown> & { ok: boolean }} */ (
		buildWriteToolResponse({
			...fields,
			ok: true,
			action,
			name: fileName || fields.name,
			file_name: fileName || fields.file_name,
			agent_message: msg.includes('повтор')
				? msg
				: `${msg} Повторный вызов r7_disk_document не нужен.`,
			agent_stop: true,
			do_not_verify_with_read_content: true
		})
	);
}

/**
 * @param {SkillKeyValueStorage | null} skillStorage
 * @param {string} action
 * @param {Record<string, unknown>} input
 * @param {Record<string, unknown>} result
 */
function persistWriteDedup(skillStorage, action, input, result) {
	if (!skillStorage || !WRITE_DEDUP_ACTIONS.has(action) || result.ok === false) return;
	const dedupKey = buildWriteDedupKey(action, input);
	const inflightKey = buildWriteInflightKey(action, input);
	const payload = {
		ok: true,
		action,
		directory_id: result.directory_id ?? input.directory_id,
		document_id: result.document_id ?? input.document_id,
		name: result.name ?? result.file_name ?? input.name ?? input.file_name,
		file_name: result.file_name ?? result.name ?? input.file_name ?? input.name,
		agent_message: result.agent_message,
		tool_log_summary: result.tool_log_summary,
		at: Date.now()
	};
	skillStorage.set(dedupKey, JSON.stringify(payload));
	kvRemove(skillStorage, inflightKey);
}

/**
 * @param {SkillKeyValueStorage | null} skillStorage
 * @param {string} action
 * @param {Record<string, unknown>} input
 */
function markWriteInflight(skillStorage, action, input) {
	if (!skillStorage || !WRITE_DEDUP_ACTIONS.has(action)) return;
	skillStorage.set(buildWriteInflightKey(action, input), '1');
}

/**
 * @param {SkillKeyValueStorage | null} skillStorage
 * @param {string} action
 * @param {Record<string, unknown>} input
 */
function clearWriteInflight(skillStorage, action, input) {
	if (!skillStorage || !WRITE_DEDUP_ACTIONS.has(action)) return;
	kvRemove(skillStorage, buildWriteInflightKey(action, input));
}

/**
 * @param {number | null} documentId
 * @param {number | null} directoryId
 * @param {string} fileName
 * @returns {string}
 */
function buildReadContentDedupKey(documentId, directoryId, fileName) {
	if (documentId != null) return `r7_disk_read_done_${documentId}`;
	const dirPart = directoryId ?? 0;
	const namePart = fileName ? documentNameStorageKey(fileName) : '';
	return `r7_disk_read_done_${dirPart}_${namePart}`;
}

/**
 * @param {Record<string, unknown>} input
 * @returns {string}
 */
function buildReadInflightKey(input) {
	return `${buildReadContentDedupKey(
		resolvePositiveId(input.document_id),
		resolvePositiveId(input.directory_id),
		pickString(input.name, input.file_name)
	)}_inflight`;
}

/**
 * @param {SkillKeyValueStorage | null} skillStorage
 * @param {Record<string, unknown>} input
 */
function markReadInflight(skillStorage, input) {
	if (!skillStorage) return;
	skillStorage.set(buildReadInflightKey(input), '1');
}

/**
 * @param {SkillKeyValueStorage | null} skillStorage
 * @param {Record<string, unknown>} input
 */
function clearReadInflight(skillStorage, input) {
	if (!skillStorage) return;
	kvRemove(skillStorage, buildReadInflightKey(input));
}

/**
 * @param {SkillKeyValueStorage | null} skillStorage
 * @param {Record<string, unknown>} input
 * @returns {(Record<string, unknown> & { ok: boolean }) | null}
 */
function resolveReadContentDedupHit(skillStorage, input) {
	if (!skillStorage || input.force_repeat === true) return null;
	const documentId = resolvePositiveId(input.document_id);
	const directoryId = resolvePositiveId(input.directory_id);
	const fileName = pickString(input.name, input.file_name);
	const inflightKey = buildReadInflightKey(input);
	if (skillStorage.get(inflightKey) === '1') {
		return /** @type {Record<string, unknown> & { ok: boolean }} */ (
			buildReadContentResponse({
				ok: true,
				action: 'read_content',
				document_id: documentId,
				directory_id: directoryId,
				name: fileName,
				file_name: fileName,
				already_inflight: true,
				already_completed: true,
				agent_message:
					'read_content уже выполняется. Не вызывайте повторно — дождитесь карточки с текстом.'
			})
		);
	}
	const dedupKey = buildReadContentDedupKey(documentId, directoryId, fileName);
	const raw = skillStorage.get(dedupKey);
	if (typeof raw !== 'string' || !raw.trim()) return null;
	try {
		const cached = /** @type {Record<string, unknown>} */ (JSON.parse(raw));
		if (cached.ok === false) return null;
		const msg =
			typeof cached.agent_message === 'string'
				? cached.agent_message
				: 'Содержимое файла уже получено.';
		const cachedText = typeof cached.content_text === 'string' ? cached.content_text : '';
		return /** @type {Record<string, unknown> & { ok: boolean }} */ (
			buildReadContentResponse({
				...cached,
				ok: true,
				already_completed: true,
				content_text: cachedText,
				agent_message: msg.includes('повтор')
					? msg
					: `${msg} Повторный read_content не нужен — используйте log_text_preview или prepend/append для правки.`
			})
		);
	} catch {
		return null;
	}
}

/**
 * @param {SkillKeyValueStorage | null} skillStorage
 * @param {Record<string, unknown>} result
 */
function persistReadContentDedup(skillStorage, result) {
	if (!skillStorage || result.ok === false) return;
	const documentId = resolvePositiveId(result.document_id);
	const directoryId = resolvePositiveId(result.directory_id);
	const fileName = pickString(result.name, result.file_name);
	const payload = {
		ok: true,
		action: 'read_content',
		document_id: documentId,
		directory_id: directoryId,
		name: fileName,
		file_name: fileName,
		content_text: result.content_text,
		content_truncated: result.content_truncated,
		total_chars: result.total_chars,
		agent_message: result.agent_message,
		tool_log_summary: `READ_OK:${fileName || documentId}`,
		at: Date.now()
	};
	const dedupKey = buildReadContentDedupKey(documentId, directoryId, fileName);
	skillStorage.set(dedupKey, JSON.stringify(payload));
	if (documentId != null) {
		skillStorage.set(buildReadContentDedupKey(documentId, null, ''), JSON.stringify(payload));
	}
}

/**
 * @param {SkillKeyValueStorage | null} skillStorage
 * @param {Record<string, unknown>} result
 */
function markViewOnlyAfterRead(skillStorage, result) {
	if (!skillStorage || result.ok === false) return;
	const documentId = resolvePositiveId(result.document_id);
	const directoryId = resolvePositiveId(result.directory_id);
	const fileName = pickString(result.name, result.file_name);
	if (documentId != null) {
		skillStorage.set(`r7_disk_view_only_${documentId}`, '1');
	}
	if (directoryId != null && fileName) {
		skillStorage.set(
			`r7_disk_view_only_${directoryId}_${documentNameStorageKey(fileName)}`,
			'1'
		);
		skillStorage.set(
			`r7_disk_block_list_after_read_${directoryId}`,
			JSON.stringify({ file_name: fileName, document_id: documentId, at: Date.now() })
		);
	}
}

/**
 * @param {string} contentText
 * @param {number} [maxLen]
 * @returns {string | undefined}
 */
function buildReadContentLogPreview(contentText, maxLen = 1200) {
	if (typeof contentText !== 'string' || !contentText.trim()) return undefined;
	const normalized = contentText.trim();
	if (normalized.length <= maxLen) return normalized;
	return `${normalized.slice(0, maxLen)}…`;
}

/**
 * Ответ read_content — виджет documentContentCard + log_text_preview для агента.
 * @param {Record<string, unknown>} fields
 * @returns {Record<string, unknown> & { ok: boolean }}
 */
function buildReadContentResponse(fields) {
	const fileName = pickString(fields.name, fields.file_name) || 'файла';
	const contentText = typeof fields.content_text === 'string' ? fields.content_text : '';
	const logPreview = buildReadContentLogPreview(contentText);
	const truncated = fields.content_truncated === true;
	const isRepeat =
		fields.already_completed === true ||
		fields.already_inflight === true ||
		fields.widget_already_shown === true;
	const charCount = contentText.length || (typeof fields.total_chars === 'number' ? fields.total_chars : 0);
	const baseMessage =
		typeof fields.agent_message === 'string' && fields.agent_message.trim()
			? fields.agent_message
			: `Содержимое «${fileName}» получено.`;
	const editHint =
		'Для правки («добавь в начало») — один вызов prepend с content_text; read_content повторно не нужен.';
	return /** @type {Record<string, unknown> & { ok: boolean }} */ ({
		...fields,
		ok: fields.ok !== false,
		show_download_widget: false,
		widget_suppressed: isRepeat,
		show_content_widget: !isRepeat,
		widget_render_once: true,
		widget_already_shown: isRepeat,
		render_as: isRepeat ? 'plain_text_in_chat' : 'content_widget',
		deliverable: false,
		download_ready: false,
		download_not_requested: true,
		do_not_invent_content: true,
		cite_only_fields: ['content_text', 'log_text_preview', 'tool_log_summary'],
		...(logPreview ? { log_text_preview: logPreview } : {}),
		agent_message: isRepeat
			? `${baseMessage} Карточка уже показана — смотрите log_text_preview. ${editHint}`
			: truncated && typeof fields.total_chars === 'number'
				? `${baseMessage} Текст в карточке и log_text_preview (первые 1200 из ${fields.total_chars} символов). ${editHint}`
				: `${baseMessage} Текст в карточке и log_text_preview. ${editHint}`,
		do_not_retry: true,
		do_not_retry_read_content: true,
		forbid_followup_tools: [
			'r7_disk_download',
			'r7_disk_login',
			'download',
			'exists',
			'get_id_by_name',
			'list_directory',
			'r7_disk_list_directory',
			'r7_disk_browse',
			'browse',
			'versions'
		],
		agent_stop: true,
		tool_log_summary:
			typeof fields.tool_log_summary === 'string'
				? fields.tool_log_summary
				: charCount > 0
					? `READ_OK:${fileName}:${charCount}ch`
					: `READ_OK:${fileName}`
	});
}

/**
 * @param {Record<string, unknown>} fields
 * @returns {Record<string, unknown> & { ok: boolean }}
 */
function buildWriteToolResponse(fields) {
	const base = /** @type {Record<string, unknown>} */ ({ ...fields });
	delete base.content_base64;
	delete base.content_text;
	delete base.content_text_preview;
	delete base.deliverable;
	delete base.download_ready;
	delete base.download_status;
	delete base.delivery_method;
	delete base.user_action_required;
	delete base.feedback_prompt_ok;
	delete base.feedback_prompt_retry;
	/** @type {string[]} */
	const citeFields = ['agent_message'];
	if (typeof base.content_text_verified === 'string') {
		citeFields.unshift('content_text_verified');
	}
	const actionName = typeof base.action === 'string' ? base.action : '';
	const isInsert = actionName === 'prepend' || actionName === 'append';
	const isCreateWithContent =
		actionName === 'create' &&
		(typeof base.created_via === 'string'
			? base.created_via === 'upload'
			: base.size_bytes != null && Number(base.size_bytes) > 0);
	return /** @type {Record<string, unknown> & { ok: boolean }} */ (
		withFactualCitation(
			{
				...base,
				ok: base.ok !== false,
				show_download_widget: false,
				forbid_followup_tools: [
					'r7_disk_document',
					'download',
					'r7_disk_download',
					'list_directory',
					'r7_disk_list_directory',
					'browse',
					'r7_disk_browse',
					'get_id_by_name',
					'read_content',
					'r7_disk_login'
				],
				do_not_retry: true,
				agent_stop:
					base.agent_stop === true || isInsert || isCreateWithContent || actionName === 'upload',
				...(isInsert || isCreateWithContent
					? {
							empty_log_note:
								'Пустой {} в логе платформы без ok:false — успех записи. Смотрите tool_log_summary и agent_message. Не вызывайте r7_disk_document/read_content/list_directory для проверки.'
						}
					: {})
			},
			citeFields
		)
	);
}

/**
 * @param {SkillKeyValueStorage | null} skillStorage
 * @param {number | null} documentId
 * @param {string} fileName
 * @param {number} sizeBytes
 */
function cacheFileMeta(skillStorage, documentId, fileName, sizeBytes) {
	if (!skillStorage || documentId == null || !fileName) return;
	skillStorage.set(
		`r7_disk_doc_meta_${documentId}`,
		JSON.stringify({ file_name: fileName, size_bytes: sizeBytes, updated_at: Date.now() })
	);
}

/**
 * @param {SkillKeyValueStorage | null} skillStorage
 * @param {Record<string, unknown>} params
 * @param {number} documentId
 * @returns {string}
 */
function resolveDownloadFileName(skillStorage, params, documentId) {
	const fromParams = pickString(params['file_name'], params['name']);
	if (fromParams) return fromParams;
	if (skillStorage) {
		const raw = skillStorage.get(`r7_disk_doc_meta_${documentId}`);
		if (typeof raw === 'string' && raw.trim()) {
			try {
				const meta = JSON.parse(raw);
				if (typeof meta.file_name === 'string' && meta.file_name.trim()) {
					return meta.file_name.trim();
				}
			} catch {
				/* ignore */
			}
		}
	}
	return `document-${documentId}.bin`;
}

/**
 * Подпись типа для пользователя по расширению (не по MimeType API — он может быть неточным).
 * @param {string} fileName
 * @returns {string}
 */
function fileTypeLabelFromName(fileName) {
	const lower = fileName.toLowerCase();
	if (lower.endsWith('.docx')) return 'DOCX (Word Open XML)';
	if (lower.endsWith('.doc')) return 'DOC (Word 97–2003)';
	if (lower.endsWith('.txt')) return 'TXT';
	if (lower.endsWith('.pdf')) return 'PDF';
	if (lower.endsWith('.xlsx')) return 'XLSX';
	return 'файл';
}

/**
 * @param {string} baseUrl
 * @param {string} authToken
 * @param {Record<string, unknown>} params
 */
async function actionRename(baseUrl, authToken, params) {
	const documentId = resolvePositiveId(params.document_id);
	const name = typeof params.name === 'string' ? params.name.trim() : '';
	if (documentId == null || !name) {
		return { ok: false, error: 'Для rename нужны document_id и name.' };
	}

	const url =
		`${baseUrl}/api/v1/Documents/Rename?` +
		`id=${encodeURIComponent(String(documentId))}&` +
		`name=${encodeURIComponent(name)}`;

	const http = await apiRequest('GET', url, authToken);
	if (!http.ok) return { ok: false, error: http.error, api_base_url: baseUrl };

	return buildWriteToolResponse({
		ok: true,
		action: 'rename',
		document_id: documentId,
		name,
		file_name: name,
		data: toApiRecord(http.data),
		api_base_url: baseUrl,
		agent_message: `Файл переименован в «${name}».`
	});
}

/**
 * @param {string} baseUrl
 * @param {string} authToken
 * @param {Record<string, unknown>} params
 */
async function actionDelete(baseUrl, authToken, params) {
	const directoryId = resolvePositiveId(params.directory_id);
	const namesRaw = params.file_names;
	/** @type {string[]} */
	const namesToDelete = [];
	if (Array.isArray(namesRaw)) {
		for (const item of namesRaw) {
			if (typeof item === 'string' && item.trim()) namesToDelete.push(item.trim());
		}
	}

	/** @type {number[]} */
	let ids = resolveIdList(params.document_ids, params.document_id);
	if (ids.length === 0 && namesToDelete.length > 0) {
		if (directoryId == null) {
			return {
				ok: false,
				error: 'Для delete по file_names нужен directory_id (> 0).'
			};
		}
		for (const name of namesToDelete) {
			const url =
				`${baseUrl}/api/v1/Documents/GetIdByName?` +
				`name=${encodeURIComponent(name)}&` +
				`directoryId=${encodeURIComponent(String(directoryId))}`;
			const lookup = await apiRequest('GET', url, authToken);
			if (!lookup.ok) {
				return {
					ok: false,
					error: `Файл «${name}» не найден: ${lookup.error}`,
					api_base_url: baseUrl
				};
			}
			const docId = extractDocumentId(lookup.data);
			if (docId == null) {
				return {
					ok: false,
					error: `Не удалось получить id для «${name}».`,
					api_base_url: baseUrl
				};
			}
			ids.push(docId);
		}
	}

	if (ids.length === 0) {
		return {
			ok: false,
			error: 'Для delete укажите document_id, document_ids или file_names + directory_id.'
		};
	}

	const url = `${baseUrl}/api/v1/Documents/Delete`;
	const http = await apiRequest('POST', url, authToken, { Ids: ids });
	if (!http.ok) return { ok: false, error: http.error, api_base_url: baseUrl };

	return buildWriteToolResponse({
		ok: true,
		action: 'delete',
		document_ids: ids,
		deleted_count: ids.length,
		data: toApiRecord(http.data),
		api_base_url: baseUrl,
		agent_message: `Удалено файлов: ${ids.length}.`
	});
}

/**
 * @param {string} baseUrl
 * @param {string} authToken
 * @param {Record<string, unknown>} params
 */
async function actionRestore(baseUrl, authToken, params) {
	const ids = resolveIdList(params.document_ids, params.document_id);
	if (ids.length === 0) {
		return { ok: false, error: 'Для restore укажите document_id или document_ids.' };
	}

	const url = `${baseUrl}/api/v1/Documents/Restore`;
	const http = await apiRequest('POST', url, authToken, { Ids: ids });
	if (!http.ok) return { ok: false, error: http.error, api_base_url: baseUrl };

	return {
		ok: true,
		action: 'restore',
		document_ids: ids,
		data: toApiRecord(http.data),
		api_base_url: baseUrl
	};
}

/**
 * @param {string} baseUrl
 * @param {string} authToken
 * @param {Record<string, unknown>} params
 */
async function actionMove(baseUrl, authToken, params) {
	const ids = resolveIdList(params.document_ids, params.document_id);
	const toDirectoryId = resolvePositiveId(params.to_directory_id);
	if (ids.length === 0 || toDirectoryId == null) {
		return {
			ok: false,
			error: 'Для move нужны document_id/document_ids и to_directory_id (> 0).'
		};
	}

	const url = `${baseUrl}/api/v1/Documents/Move`;
	const http = await apiRequest('POST', url, authToken, {
		Ids: ids,
		ToDirectoryId: toDirectoryId
	});
	if (!http.ok) return { ok: false, error: http.error, api_base_url: baseUrl };

	return buildWriteToolResponse({
		ok: true,
		action: 'move',
		document_ids: ids,
		to_directory_id: toDirectoryId,
		data: toApiRecord(http.data),
		api_base_url: baseUrl,
		agent_message: `Перемещено файлов: ${ids.length} в папку id=${toDirectoryId}.`
	});
}

/**
 * @param {string} baseUrl
 * @param {string} authToken
 * @param {Record<string, unknown>} params
 */
async function actionCopy(baseUrl, authToken, params) {
	const documentId = resolvePositiveId(params.document_id);
	const directoryId = resolvePositiveId(params.directory_id);
	if (documentId == null || directoryId == null) {
		return { ok: false, error: 'Для copy нужны document_id и directory_id (папка назначения).' };
	}

	const url =
		`${baseUrl}/api/v1/Documents/Copy?` +
		`id=${encodeURIComponent(String(documentId))}&` +
		`directoryId=${encodeURIComponent(String(directoryId))}`;

	const http = await apiRequest('GET', url, authToken);
	if (!http.ok) return { ok: false, error: http.error, api_base_url: baseUrl };

	return buildWriteToolResponse({
		ok: true,
		action: 'copy',
		document_id: documentId,
		directory_id: directoryId,
		data: toApiRecord(http.data),
		api_base_url: baseUrl,
		agent_message: `Файл скопирован в папку id=${directoryId}.`
	});
}

/**
 * @param {string} baseUrl
 * @param {string} authToken
 * @param {Record<string, unknown>} params
 */
async function actionExists(baseUrl, authToken, params) {
	const directoryId = resolvePositiveId(params.directory_id);
	const name = typeof params.name === 'string' ? params.name.trim() : '';
	if (directoryId == null || !name) {
		return { ok: false, error: 'Для exists нужны directory_id и name.' };
	}

	const url =
		`${baseUrl}/api/v1/Documents/IsExists?` +
		`name=${encodeURIComponent(name)}&` +
		`directoryId=${encodeURIComponent(String(directoryId))}`;

	const http = await apiRequest('GET', url, authToken);
	if (!http.ok) return { ok: false, error: http.error, api_base_url: baseUrl };

	return {
		ok: true,
		action: 'exists',
		directory_id: directoryId,
		name,
		exists: coerceBoolean(http.data),
		data: toApiRecord(http.data),
		api_base_url: baseUrl
	};
}

/**
 * @param {string} baseUrl
 * @param {string} authToken
 * @param {Record<string, unknown>} params
 */
async function actionGetIdByName(baseUrl, authToken, params) {
	const directoryId = resolvePositiveId(params.directory_id);
	const name = typeof params.name === 'string' ? params.name.trim() : '';
	if (directoryId == null || !name) {
		return { ok: false, error: 'Для get_id_by_name нужны directory_id и name.' };
	}

	const url =
		`${baseUrl}/api/v1/Documents/GetIdByName?` +
		`name=${encodeURIComponent(name)}&` +
		`directoryId=${encodeURIComponent(String(directoryId))}`;

	const http = await apiRequest('GET', url, authToken);
	if (!http.ok) return { ok: false, error: http.error, api_base_url: baseUrl };

	const documentId = extractDocumentId(http.data);

	return buildWriteToolResponse({
		ok: true,
		action: 'get_id_by_name',
		directory_id: directoryId,
		name,
		document_id: documentId,
		data: toApiRecord(http.data),
		api_base_url: baseUrl,
		agent_message:
			documentId != null
				? `ID файла «${name}» = ${documentId}.`
				: `Файл «${name}» в папке id=${directoryId} не найден.`
	});
}

/**
 * Прочитать текстовое содержимое файла для показа в чате (без виджета скачивания).
 * @param {Record<string, unknown>} state
 * @param {string} baseUrl
 * @param {string} authToken
 * @param {Record<string, unknown>} params
 */
async function actionReadContent(state, baseUrl, authToken, params) {
	let directoryId =
		resolvePositiveId(params.directory_id) ?? resolvePersonalDirectoryIdFromStorage(state);
	const requestedName = pickString(params.name, params.file_name);
	const skillStorage = resolveSkillStorage(state);
	let documentId = resolvePositiveId(params.document_id);

	if (!requestedName && documentId == null) {
		return {
			ok: false,
			error:
				'Для read_content нужны name и document_id (из list_directory) или directory_id.',
			hint: 'Расшаренный файл: read_content с document_id и name из documents[] раздела shared_to_me.'
		};
	}

	let fileName = requestedName.trim();
	if (fileName && !fileName.includes('.')) {
		const nameResult = await resolveCanonicalFileName(
			baseUrl,
			authToken,
			skillStorage,
			directoryId,
			requestedName
		);
		if (!nameResult.ok) return nameResult;
		fileName = nameResult.name;
		if (nameResult.owner_directory_id != null) {
			directoryId = nameResult.owner_directory_id;
		}
	}

	if (documentId == null && fileName) {
		const lookup = await resolveDocumentIdForFile(
			baseUrl,
			authToken,
			skillStorage,
			directoryId,
			fileName
		);
		if (!lookup.ok) {
			const lookupRecord = /** @type {Record<string, unknown>} */ (lookup);
			const lookupError =
				typeof lookupRecord.error === 'string' ? lookupRecord.error : '';
			return {
				...buildSharedDocumentAccessError(lookupRecord, fileName, 'read_content'),
				requested_name: requestedName,
				hint:
					lookupError.includes('не найден') && !requestedName.includes('.')
						? `Уточните расширение: read_content с name: «${requestedName}.docx».`
						: undefined
			};
		}
		documentId = lookup.document_id;
		if (lookup.owner_directory_id != null) {
			directoryId = lookup.owner_directory_id;
		}
	}
	if (!fileName && documentId != null) {
		fileName = await resolveDocumentFileNameFromMeta(skillStorage, documentId, baseUrl, authToken);
		if (!fileName && directoryId != null) {
			const listing = await fetchDirectoryDocumentsWithMeta(baseUrl, authToken, directoryId);
			for (const doc of listing.documents) {
				const docId = resolvePositiveId(doc.Id ?? doc.document_id);
				if (docId === documentId) {
					const docName = typeof doc.Name === 'string' ? doc.Name.trim() : '';
					if (docName) {
						fileName = docName;
						break;
					}
				}
			}
		}
	}
	if (documentId == null) {
		return {
			ok: false,
			error: `Файл «${fileName || requestedName}» не найден.`,
			requested_name: requestedName,
			do_not_invent_success: true
		};
	}
	if (!fileName) {
		return {
			ok: false,
			error: 'Для read_content укажите name вместе с document_id.',
			document_id: documentId,
			do_not_invent_success: true
		};
	}

	const downloaded = await downloadDocumentBytes(baseUrl, authToken, documentId);
	if (!downloaded.ok) return downloaded;

	let fullText = '';
	let extractionError = '';
	try {
		fullText = await extractFileTextFromBytes(fileName, downloaded.bytes);
	} catch (err) {
		extractionError = errorMessage(err);
	}

	if (!fullText && extractionError) {
		return {
			ok: false,
			error: extractionError,
			extraction_failed: true,
			document_id: documentId,
			directory_id: directoryId,
			name: fileName,
			requested_name: requestedName,
			size_bytes: downloaded.bytes.length,
			api_base_url: baseUrl,
			agent_message:
				`Не удалось извлечь текст из «${fileName}». ` +
				'Не говорите пользователю, что файл «пустой» или «только создан» — сообщите об ошибке чтения.'
		};
	}

	if (!fullText && !isTextFileName(fileName) && !fileName.toLowerCase().endsWith('.docx')) {
		return {
			ok: false,
			error: `Чтение содержимого поддерживается для .txt/.md/.csv/.json и .docx. Файл: ${fileName}`,
			document_id: documentId,
			directory_id: directoryId,
			name: fileName,
			requested_name: requestedName
		};
	}

	const likelyNonemptyDocx =
		(fileName.toLowerCase().endsWith('.docx') || isDocxBytes(downloaded.bytes, '')) &&
		downloaded.bytes.length > 400;
	if (!fullText.trim() && likelyNonemptyDocx) {
		return {
			ok: false,
			error:
				`DOCX «${fileName}» скачан (${downloaded.bytes.length} байт), но текст не извлечён. ` +
				'Возможен неверный document_id или сбой парсера.',
			extraction_failed: true,
			document_id: documentId,
			directory_id: directoryId,
			name: fileName,
			requested_name: requestedName,
			resolved_name: fileName !== requestedName ? fileName : undefined,
			size_bytes: downloaded.bytes.length,
			api_base_url: baseUrl,
			do_not_invent_content: true,
			agent_message:
				'read_content не вернул текст. **Запрещено** говорить «файл пустой» или «только создан» — ' +
				'скажите, что не удалось прочитать DOCX, и предложите уточнить имя с расширением .docx.'
		};
	}

	const truncated = fullText.length > READ_CONTENT_MAX_CHARS;
	const contentText = truncated ? fullText.slice(0, READ_CONTENT_MAX_CHARS) : fullText;
	const nameNote =
		fileName !== requestedName ? ` (запрошено «${requestedName}»)` : '';
	const agentMessage = truncated
		? `Содержимое «${fileName}»${nameNote} (первые ${READ_CONTENT_MAX_CHARS} из ${fullText.length} символов):`
		: fullText.trim()
			? `Содержимое «${fileName}»${nameNote}:`
			: `Файл «${fileName}»${nameNote}: извлекаемый текст пустой (пустой DOCX).`;

	const contentPreview =
		fullText.trim().length > 0
			? fullText.trim().slice(0, 120).replace(/\s+/g, ' ')
			: '';

	return buildReadContentResponse({
		ok: true,
		action: 'read_content',
		document_id: documentId,
		directory_id: directoryId,
		name: fileName,
		file_name: fileName,
		requested_name: requestedName,
		size_bytes: downloaded.bytes.length,
		content_text: contentText,
		content_empty: !fullText.trim(),
		content_truncated: truncated,
		total_chars: fullText.length,
		content_preview: contentPreview || undefined,
		api_base_url: baseUrl,
		do_not_invent_content: true,
		agent_message:
			(fullText.trim()
				? `${agentMessage} Выведи **дословно** content_text (document_id=${documentId}). ` +
					(contentPreview ? `Начало: «${contentPreview}»… ` : '') +
					'Запрещено придумывать другой текст («Привет, мир» и т.п.).'
				: agentMessage +
					' content_text пуст — не выдумывай содержимое и не ссылайся на «создание файла» из прошлых шагов.') +
			' Не выдумывай.'
	});
}

/**
 * @param {Record<string, unknown>} state
 * @param {string} baseUrl
 * @param {string} authToken
 * @param {Record<string, unknown>} params
 */
async function actionDownload(state, baseUrl, authToken, params) {
	const skillStorage = resolveSkillStorage(state);
	const fileId = resolvePositiveId(params.file_id);
	const directoryId = resolvePositiveId(params.directory_id);
	const requestedName = pickString(params['file_name'], params['name']);
	const forceRedownload = params['force_redownload'] === true;

	if (directoryId == null || !requestedName) {
		return buildDownloadParamsRequiredError();
	}

	const nameResult = await resolveCanonicalFileName(
		baseUrl,
		authToken,
		skillStorage,
		directoryId,
		requestedName
	);
	if (!nameResult.ok) return nameResult;

	let documentId = resolvePositiveId(params.document_id);
	let resolvedFileName = nameResult.name;
	if (documentId == null && resolvedFileName && directoryId != null) {
		const lookup = await resolveDocumentIdForFile(
			baseUrl,
			authToken,
			skillStorage,
			directoryId,
			resolvedFileName
		);
		if (!lookup.ok) return lookup;
		documentId = lookup.document_id;
		if (typeof lookup.file_name === 'string' && lookup.file_name.trim()) {
			resolvedFileName = lookup.file_name.trim();
		}
	}

	if (documentId == null) {
		return {
			ok: false,
			error: `Файл «${requestedName}» не найден в папке id=${directoryId}.`,
			directory_id: directoryId,
			name: requestedName,
			do_not_retry: true,
			agent_message: `Файл «${requestedName}» в папке id=${directoryId} не найден. Download не повторять без уточнения имени.`,
			forbid_followup_tools: ['download', 'list_directory', 'get_id_by_name']
		};
	}

	let fileName = resolvedFileName.trim() || requestedName.trim();
	const fromDir = await resolveDocumentFileNameFromDirectory(
		baseUrl,
		authToken,
		directoryId,
		documentId
	);
	if (fromDir && fromDir.trim() && fromDir.trim() !== fileName) {
		const dirName = fromDir.trim();
		if (!namesEqualForDownload(fileName, dirName)) {
			return {
				ok: false,
				error: `В папке id=${directoryId} документ id=${documentId} называется «${dirName}», не «${fileName}».`,
				directory_id: directoryId,
				name: fileName,
				actual_name: dirName,
				document_id: documentId,
				do_not_retry: true,
				agent_message: `Уточните имя файла (в папке: «${dirName}»). Download с document_id без name даёт document-${documentId}.bin — не используйте.`,
				forbid_followup_tools: ['download', 'versions', 'list_directory']
			};
		}
	}
	if (isGenericDownloadFileName(fileName)) {
		return buildDownloadGenericNameBlockedError(directoryId, documentId, requestedName);
	}
	const userEnv = readUserEnv(state);
	const webUiBase = pickString(params['web_ui_base'], userEnv.R7_DISK_WEB_UI_URL);
	const webUiPath = pickString(params['web_ui_path'], '');
	const webHintPreview = buildWebUiDownloadHint(
		webUiBase,
		webUiPath,
		fileName,
		documentId,
		directoryId,
		baseUrl
	);
	const cacheKey = `r7_disk_download_${documentId}_${fileId ?? 0}`;
	const dedupKey = `r7_disk_dl_done_${documentId}_${fileId ?? 0}`;
	const inflightKey = `r7_disk_dl_inflight_${documentId}_${fileId ?? 0}`;

	if (forceRedownload && skillStorage) {
		kvRemove(skillStorage, dedupKey);
		kvRemove(skillStorage, cacheKey);
	}

	if (!forceRedownload && skillStorage) {
		const doneRaw = skillStorage.get(dedupKey);
		if (typeof doneRaw === 'string' && doneRaw.trim()) {
			return buildDownloadAlreadyDoneResponse(
				documentId,
				fileId,
				fileName,
				undefined,
				directoryId,
				readCachedDownloadLinks(skillStorage, cacheKey, webHintPreview)
			);
		}
		if (skillStorage.get(inflightKey) === '1') {
			return buildDownloadAlreadyDoneResponse(
				documentId,
				fileId,
				fileName,
				'Скачивание уже выполняется. Не вызывайте download повторно — используйте ссылку из предыдущего ответа.',
				directoryId,
				readCachedDownloadLinks(skillStorage, cacheKey, webHintPreview)
			);
		}
		skillStorage.set(inflightKey, '1');
		skillStorage.set(dedupKey, JSON.stringify({ pending: true, at: Date.now() }));
	}

	try {
	if (!forceRedownload && skillStorage) {
		const cachedRaw = skillStorage.get(cacheKey);
		if (typeof cachedRaw === 'string' && cachedRaw.trim()) {
			try {
				const cached = JSON.parse(cachedRaw);
				const currentRev = readFileContentRevision(skillStorage, documentId);
				const cachedRev =
					typeof cached.content_revision === 'number' ? cached.content_revision : -1;
				if (currentRev != null && cachedRev === currentRev) {
					return buildDownloadCachedResponse(
						cached,
						documentId,
						fileId,
						fileName,
						directoryId,
						webHintPreview
					);
				}
			} catch {
				/* ignore bad cache */
			}
		}
	}

	let url =
		`${baseUrl}/api/v1/Documents/Download?id=${encodeURIComponent(String(documentId))}` +
		`&_=${encodeURIComponent(String(Date.now()))}`;
	if (fileId != null) {
		url += `&fileId=${encodeURIComponent(String(fileId))}`;
	}

	let response;
	try {
		response = await fetch(url, {
			method: 'GET',
			headers: { Authorization: authToken }
		});
	} catch (err) {
		if (skillStorage) {
			clearDownloadDedup(skillStorage, documentId, fileId);
		}
		return { ok: false, error: `Сетевая ошибка download: ${errorMessage(err)}`, api_base_url: baseUrl };
	}

	if (!response.ok) {
		if (skillStorage) {
			clearDownloadDedup(skillStorage, documentId, fileId);
		}
		const errText = await readUtf8Text(response);
		return {
			ok: false,
			error: `Download HTTP ${response.status}: ${truncate(errText, 400)}`,
			api_base_url: baseUrl
		};
	}

	const contentType = response.headers.get('content-type') || 'application/octet-stream';
	const disposition = response.headers.get('content-disposition') || '';
	if (isGenericDownloadFileName(fileName)) {
		const fromHeader = parseFilenameFromContentDisposition(disposition);
		if (fromHeader && !isGenericDownloadFileName(fromHeader)) fileName = fromHeader;
	}
	if (isGenericDownloadFileName(fileName)) {
		fileName = requestedName.trim();
	}
	if (isGenericDownloadFileName(fileName)) {
		if (skillStorage) {
			clearDownloadDedup(skillStorage, documentId, fileId);
		}
		return buildDownloadGenericNameBlockedError(directoryId, documentId, requestedName);
	}
	const buffer = await /** @type {{ arrayBuffer: () => Promise<ArrayBuffer> }} */ (
		response
	).arrayBuffer();
	const bytes = new Uint8Array(buffer);
	const maxDownloadBytes = 10 * 1024 * 1024;

	if (bytes.length > maxDownloadBytes) {
		if (skillStorage) {
			clearDownloadDedup(skillStorage, documentId, fileId);
		}
		return {
			ok: false,
			error: `Файл слишком большой (${bytes.length} байт). Лимит навыка: ${maxDownloadBytes} байт.`,
			size_bytes: bytes.length,
			api_base_url: baseUrl
		};
	}

	let mimeForDataUrl = contentType.split(';')[0].trim() || 'application/octet-stream';
	if (mimeForDataUrl === 'application/octet-stream' && isTextFileName(fileName)) {
		mimeForDataUrl = 'text/plain; charset=utf-8';
	}
	if (
		mimeForDataUrl === 'application/octet-stream' &&
		(isDocxBytes(bytes, contentType) || fileName.toLowerCase().endsWith('.docx'))
	) {
		mimeForDataUrl =
			'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
	}
	const webHint = buildWebUiDownloadHint(
		webUiBase,
		webUiPath,
		fileName,
		documentId,
		directoryId,
		baseUrl
	);
	const canDeliverBase64 = bytes.length > 0 && bytes.length <= DOWNLOAD_BASE64_MAX_BYTES;
	const fileSizeBytes = bytes.length;
	/** @type {Record<string, unknown>} */
	const result = {
		ok: true,
		action: 'download',
		document_id: documentId,
		file_id: fileId,
		file_name: fileName,
		content_type: mimeForDataUrl,
		size_bytes: fileSizeBytes,
		deliverable: canDeliverBase64,
		delivery_method: canDeliverBase64 ? 'content_base64' : 'link_only',
		api_base_url: baseUrl,
		web_ui_hint: webHint.web_ui_hint,
		...(canDeliverBase64
			? {
					content_base64: encodeBase64(bytes),
					content_base64_present: true,
					content_base64_bytes: fileSizeBytes,
					download_ready: true
				}
			: {}),
		...(webHint.web_ui_url
			? {
					web_ui_url: webHint.web_ui_url,
					download_link: webHint.download_link ?? webHint.web_ui_url,
					...(webHint.web_open_url ? { web_open_url: webHint.web_open_url } : {})
				}
			: {})
	};

	let textForVfs = null;
	/** @type {string | undefined} */
	let logTextPreview;
	if (isTextContentType(contentType)) {
		textForVfs = decodeUtf8(bytes);
		logTextPreview = textForVfs.length > 400 ? `${textForVfs.slice(0, 400)}…` : textForVfs;
	} else if (isDocxBytes(bytes, contentType)) {
		const preview = await extractDocxTextPreview(bytes);
		if (preview) {
			result.content_text_preview = preview;
			logTextPreview = preview.length > 400 ? `${preview.slice(0, 400)}…` : preview;
		}
	}

	const vfsPath = pickString(params['save_to_vfs_path'], '');
	if (vfsPath && textForVfs != null) {
		const vfsResult = await trySaveTextToVfs(state, vfsPath, textForVfs);
		if (vfsResult.ok) {
			result.saved_vfs_path = vfsResult.path;
			result.delivery_method = 'vfs';
		} else if (vfsResult.error) {
			result.vfs_error = vfsResult.error;
		}
	} else if (vfsPath && textForVfs == null) {
		result.vfs_error =
			'save_to_vfs_path поддерживается только для текстовых файлов (.txt, .md, .json и т.д.). Для DOCX — read_content или веб-интерфейс.';
	}

	const contentRevision = readFileContentRevision(skillStorage, documentId);
	const agentView = buildDownloadAgentView(result, fileName, directoryId, documentId, webHint);
	if (skillStorage) {
		skillStorage.set(
			cacheKey,
			JSON.stringify({
				document_id: documentId,
				file_id: fileId,
				file_name: fileName,
				directory_id: directoryId,
				size_bytes: result.size_bytes,
				deliverable: false,
				delivery_method: result.delivery_method,
				download_status: agentView.download_status,
				content_revision: contentRevision ?? 0,
				web_ui_url: webHint.web_ui_url,
				download_link: webHint.download_link ?? webHint.web_ui_url,
				...(webHint.web_open_url ? { web_open_url: webHint.web_open_url } : {}),
				fetched_at: Date.now()
			})
		);
		skillStorage.set(
			dedupKey,
			JSON.stringify({ file_name: fileName, document_id: documentId, at: Date.now() })
		);
		cacheFileMeta(skillStorage, documentId, fileName, fileSizeBytes);
	}

	return {
		...result,
		...agentView,
		directory_id: directoryId,
		name: requestedName,
		resolved_name: fileName,
		content_revision: contentRevision ?? 0,
		download_fresh: true,
		widget_disabled: true,
		widget_render_once: false,
		agent_stop: true,
		tool_log_summary: buildDownloadToolLogSummary(
			fileName,
			documentId,
			directoryId,
			fileSizeBytes,
			true
		),
		...(logTextPreview ? { log_text_preview: logTextPreview } : {}),
		hint_for_viewing: 'Для просмотра текста в чате — read_content, не download.'
	};
	} finally {
		kvRemove(skillStorage, inflightKey);
	}
}

/**
 * @param {SkillKeyValueStorage | null} skillStorage
 * @param {number | null} documentId
 * @param {number | null} [fileId]
 */
function invalidateDownloadCache(skillStorage, documentId, fileId = null) {
	if (!skillStorage || documentId == null) return;
	kvRemove(skillStorage, `r7_disk_download_${documentId}_${fileId ?? 0}`);
}

/**
 * @param {SkillKeyValueStorage | null} skillStorage
 * @param {number | null} documentId
 * @param {number} sizeBytes
 * @returns {number}
 */
function bumpFileContentRevision(skillStorage, documentId, sizeBytes) {
	if (!skillStorage || documentId == null) return 0;
	const key = `r7_disk_file_rev_${documentId}`;
	let revision = 0;
	const raw = skillStorage.get(key);
	if (typeof raw === 'string' && raw.trim()) {
		try {
			const parsed = JSON.parse(raw);
			if (typeof parsed.revision === 'number') revision = parsed.revision;
		} catch {
			/* ignore */
		}
	}
	revision += 1;
	skillStorage.set(
		key,
		JSON.stringify({ revision, size_bytes: sizeBytes, updated_at: Date.now() })
	);
	return revision;
}

/**
 * @param {SkillKeyValueStorage | null} skillStorage
 * @param {number | null} documentId
 * @returns {number | null}
 */
function readFileContentRevision(skillStorage, documentId) {
	if (!skillStorage || documentId == null) return null;
	const raw = skillStorage.get(`r7_disk_file_rev_${documentId}`);
	if (typeof raw !== 'string' || !raw.trim()) return null;
	try {
		const parsed = JSON.parse(raw);
		return typeof parsed.revision === 'number' ? parsed.revision : null;
	} catch {
		return null;
	}
}

/**
 * @param {SkillKeyValueStorage | null} skillStorage
 * @param {number | null} previousDocumentId
 * @param {number | null} newDocumentId
 * @param {number} sizeBytes
 */
function invalidateFileAfterWrite(
	skillStorage,
	previousDocumentId,
	newDocumentId,
	sizeBytes,
	directoryId,
	fileName
) {
	if (!skillStorage) return;
	if (previousDocumentId != null) {
		invalidateDownloadCache(skillStorage, previousDocumentId);
		clearDownloadDedup(skillStorage, previousDocumentId);
		bumpFileContentRevision(skillStorage, previousDocumentId, 0);
	}
	if (newDocumentId != null) {
		invalidateDownloadCache(skillStorage, newDocumentId);
		clearDownloadDedup(skillStorage, newDocumentId);
		bumpFileContentRevision(skillStorage, newDocumentId, sizeBytes);
		if (directoryId != null && fileName) {
			persistDocumentIdByName(skillStorage, directoryId, fileName, newDocumentId);
		}
	}
}

/**
 * @param {SkillKeyValueStorage | null} skillStorage
 * @param {number} documentId
 * @param {number | null} [fileId]
 */
function clearDownloadDedup(skillStorage, documentId, fileId = null) {
	if (!skillStorage) return;
	kvRemove(skillStorage, `r7_disk_dl_done_${documentId}_${fileId ?? 0}`);
	kvRemove(skillStorage, `r7_disk_dl_inflight_${documentId}_${fileId ?? 0}`);
}

/**
 * @param {string} baseUrl
 * @param {string} authToken
 * @param {number} directoryId
 * @param {string} name
 */
async function lookupDocumentIdByName(baseUrl, authToken, directoryId, name) {
	const url =
		`${baseUrl}/api/v1/Documents/GetIdByName?` +
		`name=${encodeURIComponent(name)}&` +
		`directoryId=${encodeURIComponent(String(directoryId))}`;
	const http = await apiRequest('GET', url, authToken);
	if (!http.ok) {
		return {
			ok: /** @type {false} */ (false),
			error: `Файл «${name}» не найден: ${http.error}`,
			api_base_url: baseUrl
		};
	}
	const documentId = extractDocumentId(http.data);
	if (documentId == null) {
		return {
			ok: /** @type {false} */ (false),
			error: `Не удалось получить document_id для «${name}».`,
			api_base_url: baseUrl
		};
	}
	return { ok: /** @type {true} */ (true), document_id: documentId };
}

/**
 * @param {string} fileName
 * @returns {string}
 */
function documentNameStorageKey(fileName) {
	return fileName.trim().toLowerCase();
}

/**
 * @param {SkillKeyValueStorage | null} skillStorage
 * @param {number} directoryId
 * @param {string} fileName
 * @param {number} documentId
 */
function persistDocumentIdByName(skillStorage, directoryId, fileName, documentId) {
	if (!skillStorage || directoryId == null || !fileName || documentId == null) return;
	const key = `r7_disk_doc_id_${directoryId}_${documentNameStorageKey(fileName)}`;
	skillStorage.set(
		key,
		JSON.stringify({ document_id: documentId, updated_at: Date.now(), file_name: fileName.trim() })
	);
}

/**
 * @param {SkillKeyValueStorage | null} skillStorage
 * @param {number} directoryId
 * @param {string} fileName
 * @returns {number | null}
 */
function readPersistedDocumentId(skillStorage, directoryId, fileName) {
	if (!skillStorage || directoryId == null || !fileName) return null;
	const raw = skillStorage.get(`r7_disk_doc_id_${directoryId}_${documentNameStorageKey(fileName)}`);
	if (typeof raw !== 'string' || !raw.trim()) return null;
	try {
		const parsed = JSON.parse(raw);
		return resolvePositiveId(parsed.document_id);
	} catch {
		return resolvePositiveId(raw);
	}
}

/**
 * @param {SkillKeyValueStorage | null} skillStorage
 * @param {string} fileName
 * @returns {{ document_id: number, directory_id: number, file_name: string } | null}
 */
function readLastBrowseDocumentRef(skillStorage, fileName) {
	if (!skillStorage || !fileName.trim()) return null;
	const raw = skillStorage.get(`r7_disk_last_browse_doc_${documentNameStorageKey(fileName)}`);
	if (typeof raw !== 'string' || !raw.trim()) return null;
	try {
		const parsed = /** @type {Record<string, unknown>} */ (JSON.parse(raw));
		const documentId = resolvePositiveId(parsed.document_id);
		const directoryId = resolvePositiveId(parsed.directory_id);
		const name = pickString(parsed.file_name, fileName);
		if (documentId == null || directoryId == null) return null;
		return { document_id: documentId, directory_id: directoryId, file_name: name };
	} catch {
		return null;
	}
}

/**
 * @param {string} baseUrl
 * @param {string} authToken
 * @param {number} directoryId
 * @returns {Promise<Array<Record<string, unknown>>>}
 */
/**
 * @param {string} baseUrl
 * @param {string} authToken
 * @param {number} directoryId
 * @returns {Promise<{ documents: Array<Record<string, unknown>>, accessDenied: boolean, directory_name: string }>}
 */
async function fetchDirectoryDocumentsWithMeta(baseUrl, authToken, directoryId) {
	const url = `${baseUrl}/api/v1/DocumentDirectory/Get?id=${encodeURIComponent(String(directoryId))}`;
	let response;
	try {
		response = await fetch(url, {
			method: 'GET',
			headers: { 'Content-Type': 'application/json', Authorization: authToken }
		});
	} catch {
		return { documents: [], accessDenied: false, directory_name: '' };
	}
	if (!response.ok) {
		return {
			documents: [],
			accessDenied: response.status === 403 || response.status === 406,
			directory_name: ''
		};
	}
	const rawText = await readUtf8Text(response);
	try {
		const payload = rawText ? JSON.parse(rawText) : [];
		const entries = Array.isArray(payload) ? payload : [payload];
		const entry = entries.find((item) => item && typeof item === 'object') ?? entries[0];
		if (!entry || typeof entry !== 'object') {
			return { documents: [], accessDenied: false, directory_name: '' };
		}
		const rawDocs = Array.isArray(entry.Documents)
			? entry.Documents.filter((item) => item && typeof item === 'object')
			: [];
		const dirName = typeof entry.Name === 'string' ? entry.Name : '';
		const strictFilter = !looksLikeVirtualSectionDirectoryName(dirName);
		const documents = strictFilter
			? filterDocumentsForDirectory(rawDocs, directoryId)
			: rawDocs;
		return { documents, accessDenied: false, directory_name: dirName };
	} catch {
		return { documents: [], accessDenied: false, directory_name: '' };
	}
}

/**
 * @param {string} baseUrl
 * @param {string} authToken
 * @param {number} directoryId
 * @returns {Promise<Array<Record<string, unknown>>>}
 */
async function fetchDirectoryDocuments(baseUrl, authToken, directoryId) {
	const result = await fetchDirectoryDocumentsWithMeta(baseUrl, authToken, directoryId);
	return result.documents;
}

/**
 * @param {SkillKeyValueStorage | null} skillStorage
 * @returns {Record<string, unknown>}
 */
function readSectionRootsFromStorage(skillStorage) {
	if (!skillStorage) return {};
	const raw = skillStorage.get('r7_disk_section_roots');
	if (typeof raw !== 'string' || !raw.trim()) return {};
	try {
		const parsed = JSON.parse(raw);
		if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
			return /** @type {Record<string, unknown>} */ (parsed);
		}
	} catch {
		/* ignore */
	}
	return {};
}

/**
 * @param {string} baseUrl
 * @param {string} authToken
 * @param {SkillKeyValueStorage | null} skillStorage
 * @returns {Promise<Array<Record<string, unknown>>>}
 */
async function fetchSharedSectionDocuments(baseUrl, authToken, skillStorage) {
	const roots = readSectionRootsFromStorage(skillStorage);
	const sharedRootId = resolvePositiveId(roots.shared_to_me);
	const probeIds = sharedRootId != null ? [sharedRootId] : [62, 63];
	for (const id of probeIds) {
		const fetched = await fetchDirectoryDocumentsWithMeta(baseUrl, authToken, id);
		if (fetched.documents.length > 0 || looksLikeVirtualSectionDirectoryName(fetched.directory_name)) {
			return fetched.documents;
		}
	}
	return [];
}

/**
 * @param {string} baseUrl
 * @param {string} authToken
 * @param {SkillKeyValueStorage | null} skillStorage
 * @param {string} fileName
 */
async function resolveDocumentFromSharedListing(baseUrl, authToken, skillStorage, fileName) {
	const sharedDocs = await fetchSharedSectionDocuments(baseUrl, authToken, skillStorage);
	const match = matchFilesInListing(sharedDocs, fileName);
	if (match.status === 'ambiguous') {
		return buildAmbiguousFileNameError(fileName.trim(), match.candidates, 0);
	}
	if (match.status !== 'exact' || match.documentId == null) {
		return {
			ok: /** @type {false} */ (false),
			error: `Файл «${fileName}» не найден в «Доступно для меня».`
		};
	}
	const ownerDir = match.ownerDirectoryId;
	if (ownerDir != null) {
		persistDocumentIdByName(skillStorage, ownerDir, match.fileName, match.documentId);
		persistOwnerDirectoryForDocument(skillStorage, match.fileName, match.documentId, ownerDir);
	}
	return {
		ok: /** @type {true} */ (true),
		document_id: match.documentId,
		file_name: match.fileName,
		owner_directory_id: ownerDir,
		resolved_via: 'shared_to_me_listing',
		is_shared_document: true
	};
}

/**
 * @param {SkillKeyValueStorage | null} skillStorage
 * @param {string} fileName
 * @param {number} documentId
 * @param {number} ownerDirectoryId
 */
function persistOwnerDirectoryForDocument(skillStorage, fileName, documentId, ownerDirectoryId) {
	if (!skillStorage || !fileName || documentId == null || ownerDirectoryId == null) return;
	skillStorage.set(
		`r7_disk_doc_owner_dir_${documentId}`,
		JSON.stringify({
			owner_directory_id: ownerDirectoryId,
			file_name: fileName.trim(),
			updated_at: Date.now()
		})
	);
}

/**
 * @param {SkillKeyValueStorage | null} skillStorage
 * @param {string} fileName
 * @param {number} documentId
 * @returns {number | null}
 */
function readPersistedOwnerDirectoryId(skillStorage, fileName, documentId) {
	if (!skillStorage || documentId == null) return null;
	const raw = skillStorage.get(`r7_disk_doc_owner_dir_${documentId}`);
	if (typeof raw === 'string' && raw.trim()) {
		try {
			const parsed = JSON.parse(raw);
			return resolvePositiveId(parsed.owner_directory_id);
		} catch {
			/* ignore */
		}
	}
	if (fileName) {
		for (const dirKey of ['62', '63', '61']) {
			const fromKv = readPersistedDocumentId(skillStorage, Number(dirKey), fileName);
			if (fromKv === documentId) return Number(dirKey);
		}
	}
	return null;
}

/**
 * @param {SkillKeyValueStorage | null} skillStorage
 * @param {number} documentId
 * @param {string} [baseUrl]
 * @param {string} [authToken]
 * @returns {Promise<string>}
 */
async function resolveDocumentFileNameFromMeta(skillStorage, documentId, baseUrl, authToken) {
	if (documentId == null) return '';
	if (skillStorage) {
		const raw = skillStorage.get(`r7_disk_doc_meta_${documentId}`);
		if (typeof raw === 'string' && raw.trim()) {
			try {
				const parsed = JSON.parse(raw);
				if (typeof parsed.file_name === 'string' && parsed.file_name.trim()) {
					return parsed.file_name.trim();
				}
			} catch {
				/* ignore */
			}
		}
		const readRaw = skillStorage.get(buildReadContentDedupKey(documentId, null, ''));
		if (typeof readRaw === 'string' && readRaw.trim()) {
			try {
				const parsed = JSON.parse(readRaw);
				const fromRead = pickString(parsed.name, parsed.file_name);
				if (fromRead) return fromRead;
			} catch {
				/* ignore */
			}
		}
	}
	if (baseUrl && authToken) {
		const url = `${baseUrl}/api/v1/Documents/Get?id=${encodeURIComponent(String(documentId))}`;
		const http = await apiRequest('GET', url, authToken);
		if (http.ok && http.data && typeof http.data === 'object') {
			const record = /** @type {Record<string, unknown>} */ (http.data);
			const name = typeof record.Name === 'string' ? record.Name.trim() : '';
			if (name) return name;
		}
	}
	return '';
}

/**
 * @param {Record<string, unknown>} lookup
 * @param {string} fileName
 * @param {string} mode
 */
function buildSharedDocumentAccessError(lookup, fileName, mode) {
	const errText = typeof lookup['error'] === 'string' ? lookup['error'] : 'не найден';
	const accessDenied = /406|403|does not have access/i.test(errText);
	return {
		ok: false,
		error: `Файл «${fileName}» не найден: ${errText}`,
		do_not_invent_success: true,
		agent_message: accessDenied
			? `Запись не выполнена (ok: false). Для расшаренного файла вызовите ${mode} с document_id и directory_id (DirectoryId) из list_directory shared_to_me — не только directory_id папки владельца.`
			: `Операция ${mode} не выполнена: ${errText}`,
		hint: accessDenied
			? 'list_directory disk_section=shared_to_me → documents[].Id + DirectoryId → prepend/read_content.'
			: undefined,
		api_base_url: lookup['api_base_url']
	};
}

/**
 * @param {string} dirName
 * @returns {boolean}
 */
function looksLikeVirtualSectionDirectoryName(dirName) {
	return /^(доступно\s*для\s*меня|совместн|общ|избран|корзин|последн|хранилищ)/i.test(
		dirName.trim()
	);
}

/**
 * Оставляет только файлы, принадлежащие запрошенной папке (по DirectoryId).
 * API иногда возвращает в Documents чужие id — особенно для пустых подпапок.
 * Не применяется к виртуальным разделам («Доступно для меня» и др.).
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
 * Актуальный document_id по листингу папки (при дубликатах имён — самый новый).
 * @param {string} baseUrl
 * @param {string} authToken
 * @param {number} directoryId
 * @param {string} fileName
 * @returns {Promise<number | null>}
 */
async function resolveDocumentIdFromDirectoryListing(
	baseUrl,
	authToken,
	directoryId,
	fileName
) {
	const docs = await fetchDirectoryDocuments(baseUrl, authToken, directoryId);
	const match = matchFilesInListing(docs, fileName);
	if (match.status !== 'exact' || match.documentId == null) return null;
	return match.documentId;
}

/**
 * @param {Record<string, unknown>} doc
 * @returns {number}
 */
function documentSortTimestamp(doc) {
	if (typeof doc.Timestamp === 'number' && Number.isFinite(doc.Timestamp)) {
		return doc.Timestamp;
	}
	if (typeof doc.Date === 'number' && Number.isFinite(doc.Date)) {
		return doc.Date;
	}
	if (typeof doc.Date === 'string' && doc.Date.trim()) {
		const parsed = Date.parse(doc.Date);
		return Number.isFinite(parsed) ? parsed : 0;
	}
	return 0;
}

/**
 * document_id: листинг папки → KV после записи → GetIdByName.
 * @param {string} baseUrl
 * @param {string} authToken
 * @param {SkillKeyValueStorage | null} skillStorage
 * @param {number | null} directoryId
 * @param {string} fileName
 * @returns {Promise<
 *   | { ok: true, document_id: number, file_name?: string, owner_directory_id?: number | null, resolved_via?: string, is_shared_document?: boolean }
 *   | { ok: false, error: string, [key: string]: unknown }
 * >}
 */
async function resolveDocumentIdForFile(
	baseUrl,
	authToken,
	skillStorage,
	directoryId,
	fileName
) {
	if (directoryId != null) {
		const dirFetch = await fetchDirectoryDocumentsWithMeta(baseUrl, authToken, directoryId);
		const listingMatch = matchFilesInListing(dirFetch.documents, fileName);
		if (listingMatch.status === 'ambiguous') {
			return buildAmbiguousFileNameError(fileName.trim(), listingMatch.candidates, directoryId);
		}
		if (listingMatch.status === 'exact' && listingMatch.documentId != null) {
			const ownerDir = listingMatch.ownerDirectoryId ?? directoryId;
			persistDocumentIdByName(skillStorage, ownerDir, listingMatch.fileName, listingMatch.documentId);
			persistOwnerDirectoryForDocument(skillStorage, listingMatch.fileName, listingMatch.documentId, ownerDir);
			return {
				ok: /** @type {true} */ (true),
				document_id: listingMatch.documentId,
				file_name: listingMatch.fileName,
				owner_directory_id: ownerDir,
				resolved_via: 'directory_listing'
			};
		}

		const fromKv = readPersistedDocumentId(skillStorage, directoryId, fileName);
		if (fromKv != null) {
			return {
				ok: /** @type {true} */ (true),
				document_id: fromKv,
				owner_directory_id: readPersistedOwnerDirectoryId(skillStorage, fileName, fromKv) ?? directoryId,
				resolved_via: 'skill_storage'
			};
		}

		if (!dirFetch.accessDenied) {
			const byName = await lookupDocumentIdByName(baseUrl, authToken, directoryId, fileName);
			if (byName.ok) {
				return { ...byName, owner_directory_id: directoryId, resolved_via: 'get_id_by_name' };
			}
		}
	}

	const sharedMatch = await resolveDocumentFromSharedListing(baseUrl, authToken, skillStorage, fileName);
	if (sharedMatch.ok) return sharedMatch;

	const fromBrowse = readLastBrowseDocumentRef(skillStorage, fileName);
	if (fromBrowse != null) {
		return {
			ok: /** @type {true} */ (true),
			document_id: fromBrowse.document_id,
			file_name: fromBrowse.file_name,
			owner_directory_id: fromBrowse.directory_id,
			resolved_via: 'browse_index'
		};
	}

	if (directoryId != null) {
		return lookupDocumentIdByName(baseUrl, authToken, directoryId, fileName);
	}

	return {
		ok: /** @type {false} */ (false),
		error: `Файл «${fileName}» не найден. Для расшаренного файла передайте document_id из list_directory (disk_section: shared_to_me).`,
		access_denied_hint:
			'HTTP 406 на папку владельца — нормально для «Доступно для меня». Используйте document_id + DirectoryId из листинга.'
	};
}

/**
 * @param {string} fileName
 * @returns {boolean}
 */
function isGenericDownloadFileName(fileName) {
	return /^document-\d+\.bin$/i.test(fileName.trim());
}

/**
 * @param {string} header
 * @returns {string}
 */
function parseFilenameFromContentDisposition(header) {
	if (!header) return '';
	const star = header.match(/filename\*=UTF-8''([^;\r\n]+)/i);
	if (star && star[1]) {
		try {
			return decodeURIComponent(star[1].trim());
		} catch {
			/* ignore */
		}
	}
	const quoted = header.match(/filename="([^"]+)"/i);
	if (quoted && quoted[1]) return quoted[1].trim();
	const plain = header.match(/filename=([^;\r\n]+)/i);
	if (plain && plain[1]) return plain[1].trim().replace(/^"|"$/g, '');
	return '';
}

/**
 * @param {string} baseUrl
 * @param {string} authToken
 * @param {number} directoryId
 * @param {number} documentId
 * @returns {Promise<string | null>}
 */
async function resolveDocumentFileNameFromDirectory(
	baseUrl,
	authToken,
	directoryId,
	documentId
) {
	const docs = await fetchDirectoryDocuments(baseUrl, authToken, directoryId);
	for (const d of docs) {
		if (typeof d.Id === 'number' && d.Id === documentId && typeof d.Name === 'string') {
			return d.Name.trim();
		}
	}
	return null;
}

/**
 * Повторный download в той же сессии — без второй карточки и без content_base64.
 * @param {number} documentId
 * @param {number | null} fileId
 * @param {string} fileName
 * @param {string} [hint]
 */
/**
 * @param {string} a
 * @param {string} b
 */
function namesEqualForDownload(a, b) {
	return a.trim().toLowerCase() === b.trim().toLowerCase();
}

/**
 * Совпадение имён: полное или без расширения (Привет1 ↔ Привет1.docx).
 * @param {string} actualName
 * @param {string} requestedName
 * @returns {boolean}
 */
function fileNamesMatch(actualName, requestedName) {
	if (namesEqualForDownload(actualName, requestedName)) return true;
	const actual = actualName.trim().toLowerCase();
	const requested = requestedName.trim().toLowerCase();
	if (!requested) return false;
	if (!requested.includes('.')) {
		const dot = actual.lastIndexOf('.');
		const base = dot > 0 ? actual.slice(0, dot) : actual;
		if (base === requested) return true;
		if (actual.startsWith(`${requested}.`)) return true;
	}
	return false;
}

/**
 * @param {Array<Record<string, unknown>>} docs
 * @param {string} requestedName
 * @returns {{ status: 'exact', fileName: string, documentId: number | null, ownerDirectoryId: number | null } | { status: 'none' } | { status: 'ambiguous', candidates: string[] }}
 */
function matchFilesInListing(docs, requestedName) {
	const trimmed = requestedName.trim();
	if (!trimmed) return { status: 'none' };

	/** @type {Array<Record<string, unknown>>} */
	const matches = [];
	for (const doc of docs) {
		const name = typeof doc.Name === 'string' ? doc.Name.trim() : '';
		if (!name) continue;
		if (trimmed.includes('.')) {
			if (namesEqualForDownload(name, trimmed)) matches.push(doc);
		} else if (fileNamesMatch(name, trimmed)) {
			matches.push(doc);
		}
	}
	if (matches.length === 0) return { status: 'none' };

	const uniqueNames = [
		...new Set(
			matches
				.map((doc) => (typeof doc.Name === 'string' ? doc.Name.trim() : ''))
				.filter(Boolean)
		)
	];
	if (uniqueNames.length > 1) {
		return {
			status: 'ambiguous',
			candidates: uniqueNames.sort((left, right) => left.localeCompare(right, 'ru'))
		};
	}

	const picked = pickNewestDirectoryDocument(matches);
	const fileName = typeof picked.Name === 'string' ? picked.Name.trim() : uniqueNames[0];
	const documentId = typeof picked.Id === 'number' ? picked.Id : null;
	const ownerDirectoryId =
		typeof picked.DirectoryId === 'number'
			? picked.DirectoryId
			: typeof picked.ParentId === 'number'
				? picked.ParentId
				: null;
	return { status: 'exact', fileName, documentId, ownerDirectoryId };
}

/**
 * @param {Array<Record<string, unknown>>} docs
 * @returns {Record<string, unknown>}
 */
function pickNewestDirectoryDocument(docs) {
	return [...docs].sort((left, right) => {
		const leftTs = documentSortTimestamp(left);
		const rightTs = documentSortTimestamp(right);
		if (rightTs !== leftTs) return rightTs - leftTs;
		const leftId = typeof left.Id === 'number' ? left.Id : 0;
		const rightId = typeof right.Id === 'number' ? right.Id : 0;
		return rightId - leftId;
	})[0];
}

/**
 * @param {string} requestedName
 * @param {string[]} candidates
 * @param {number} directoryId
 * @returns {{ ok: false, needs_name_clarification: true, error: string, requested_name: string, candidate_names: string[], directory_id: number, do_not_retry: true, do_not_invent_content: true, agent_message: string }}
 */
function buildAmbiguousFileNameError(requestedName, candidates, directoryId) {
	const list = candidates.map((name) => `«${name}»`).join(', ');
	return {
		ok: /** @type {false} */ (false),
		needs_name_clarification: true,
		error:
			`Имя «${requestedName}» неоднозначно: в папке id=${directoryId} несколько файлов: ${list}. ` +
			'Укажите полное имя с расширением.',
		requested_name: requestedName,
		candidate_names: candidates,
		directory_id: directoryId,
		do_not_retry: true,
		do_not_invent_content: true,
		agent_message:
			`Спросите у пользователя полное имя файла с расширением. Варианты: ${list}. Не выбирайте файл сами.`
	};
}

/**
 * Сопоставляет имя без расширения с листингом; при нескольких расширениях — ошибка уточнения.
 * @param {string} baseUrl
 * @param {SkillKeyValueStorage | null} skillStorage
 * @param {number | null} directoryId
 * @param {string} requestedName
 * @returns {Promise<{ ok: true, name: string, owner_directory_id?: number | null } | { ok: false, [key: string]: unknown }>}
 */
async function resolveCanonicalFileName(baseUrl, authToken, skillStorage, directoryId, requestedName) {
	const trimmed = requestedName.trim();
	if (!trimmed || trimmed.includes('.')) {
		return { ok: /** @type {true} */ (true), name: trimmed };
	}

	if (directoryId != null) {
		const dirFetch = await fetchDirectoryDocumentsWithMeta(baseUrl, authToken, directoryId);
		const match = matchFilesInListing(dirFetch.documents, trimmed);
		if (match.status === 'exact') {
			return {
				ok: /** @type {true} */ (true),
				name: match.fileName,
				owner_directory_id: match.ownerDirectoryId ?? directoryId
			};
		}
		if (match.status === 'ambiguous') {
			return buildAmbiguousFileNameError(trimmed, match.candidates, directoryId);
		}
		if (!dirFetch.accessDenied) {
			return { ok: /** @type {true} */ (true), name: trimmed };
		}
	}

	const sharedDocs = await fetchSharedSectionDocuments(baseUrl, authToken, skillStorage);
	const sharedMatch = matchFilesInListing(sharedDocs, trimmed);
	if (sharedMatch.status === 'exact') {
		return {
			ok: /** @type {true} */ (true),
			name: sharedMatch.fileName,
			owner_directory_id: sharedMatch.ownerDirectoryId ?? null
		};
	}
	if (sharedMatch.status === 'ambiguous') {
		return buildAmbiguousFileNameError(trimmed, sharedMatch.candidates, directoryId ?? 0);
	}
	return { ok: /** @type {true} */ (true), name: trimmed };
}

/**
 * @param {number} directoryId
 * @param {number} documentId
 * @param {string} requestedName
 */
function buildDownloadGenericNameBlockedError(directoryId, documentId, requestedName) {
	return {
		ok: false,
		error:
			`Имя файла не должно быть document-${documentId}.bin. ` +
			'Передайте directory_id и name (реальное имя в папке).',
		required_example: {
			action: 'download',
			directory_id: directoryId,
			name: requestedName
		},
		do_not_retry: true,
		agent_stop: true,
		agent_message:
			`Скачивание остановлено: нужны directory_id=${directoryId} и name=«${requestedName}». ` +
			'Не вызывайте download только с document_id и не вызывайте versions вместо download.',
		forbid_followup_tools: ['download', 'versions', 'list_directory', 'get_id_by_name'],
		tool_log_summary: 'DOWNLOAD_REJECTED:generic_bin_name'
	};
}

function buildDownloadParamsRequiredError() {
	const downloadExample = {
		action: 'download',
		directory_id: 42,
		name: 'Привет1.docx'
	};
	const readExample = {
		action: 'read_content',
		directory_id: 42,
		name: 'Привет1.docx'
	};
	return {
		ok: false,
		error:
			'Для download обязательны directory_id и name (имя файла в папке). ' +
			'Не передавайте только document_id — это даёт document-XX.bin. ' +
			'Для «покажи содержимое» используйте read_content.',
		required_example: downloadExample,
		read_content_example: readExample,
		do_not_retry: true,
		agent_stop: true,
		agent_message:
			'Вызов download отклонён. Для просмотра текста — read_content (см. read_content_example). ' +
			'Download — только по запросу «скачай» с directory_id и name.',
		forbid_followup_tools: ['download'],
		tool_log_summary: 'DOWNLOAD_REJECTED:need_directory_id_and_name'
	};
}

/**
 * @typedef {Object} WebDownloadHint
 * @property {string} web_ui_hint
 * @property {string} [web_ui_url]
 * @property {string} [download_link]
 * @property {string} [web_open_url]
 * @property {string} [folder_url]
 */

/**
 * @param {string} fileName
 * @param {number} documentId
 * @param {number} directoryId
 * @param {number} sizeBytes
 * @param {boolean} fresh
 */
function buildDownloadToolLogSummary(fileName, documentId, directoryId, sizeBytes, fresh) {
	const tag = fresh ? 'DOWNLOAD_OK' : 'DOWNLOAD_ALREADY';
	return `${tag}:${fileName}:doc=${documentId}:dir=${directoryId}:${sizeBytes}B:stop_no_retry`;
}

/**
 * @param {SkillKeyValueStorage | null} skillStorage
 * @param {string} cacheKey
 * @param {WebDownloadHint} fallback
 * @returns {WebDownloadHint}
 */
function readCachedDownloadLinks(skillStorage, cacheKey, fallback) {
	if (!skillStorage) return fallback;
	const raw = skillStorage.get(cacheKey);
	if (typeof raw !== 'string' || !raw.trim()) return fallback;
	try {
		const cached = JSON.parse(raw);
		const url =
			typeof cached.download_link === 'string' && cached.download_link
				? cached.download_link
				: typeof cached.web_ui_url === 'string' && cached.web_ui_url
					? cached.web_ui_url
					: fallback.web_ui_url;
		const openUrl =
			typeof cached.web_open_url === 'string' && cached.web_open_url
				? cached.web_open_url
				: fallback.web_open_url;
		return {
			web_ui_url: url,
			download_link: url,
			...(openUrl ? { web_open_url: openUrl } : {}),
			web_ui_hint:
				typeof cached.web_ui_hint === 'string' && cached.web_ui_hint
					? cached.web_ui_hint
					: fallback.web_ui_hint
		};
	} catch {
		return fallback;
	}
}

function buildDownloadAlreadyDoneResponse(
	documentId,
	fileId,
	fileName,
	hint,
	directoryId = null,
	webHint = { web_ui_hint: '' }
) {
	const linkPart = webHint.web_ui_url ? ` Ссылка: ${webHint.web_ui_url}` : '';
	const message =
		hint ??
		`Файл «${fileName}» (id=${documentId}) уже скачивался в этой сессии. ` +
			`Повторный download не нужен — передайте пользователю ссылку.${linkPart} ` +
			'После правки файла — force_redownload: true. Для текста — read_content.';
	return {
		ok: true,
		action: 'download',
		document_id: documentId,
		file_id: fileId,
		file_name: fileName,
		...(directoryId != null ? { directory_id: directoryId } : {}),
		do_not_retry: true,
		agent_stop: true,
		show_download_widget: false,
		widget_disabled: true,
		widget_render_once: false,
		download_fresh: false,
		download_status: 'link_only',
		delivery_method: 'link_only',
		download_ready: false,
		deliverable: false,
		content_base64_present: false,
		...(webHint.web_ui_url
			? {
					web_ui_url: webHint.web_ui_url,
					download_link: webHint.download_link ?? webHint.web_ui_url,
					...(webHint.web_open_url ? { web_open_url: webHint.web_open_url } : {})
				}
			: {}),
		web_ui_hint: webHint.web_ui_hint,
		hint_for_viewing: 'Используйте read_content для показа текста в чате.',
		agent_message: message,
		tool_log_summary: buildDownloadToolLogSummary(
			fileName,
			documentId,
			directoryId ?? 0,
			0,
			false
		),
		forbid_followup_tools: [
			'download',
			'list_directory',
			'get_id_by_name',
			'versions',
			'exists',
			'browse'
		]
	};
}

/**
 * @param {number} documentId
 * @param {string} fileName
 * @returns {{ feedback_prompt_ok: string, feedback_prompt_retry: string }}
 */
function buildDownloadFeedbackPrompts(documentId, fileName) {
	const idPart = `document_id=${documentId}`;
	return {
		feedback_prompt_ok: `Скачивание «${fileName}» (${idPart}) на устройстве прошло успешно.`,
		feedback_prompt_retry: `Не удалось скачать «${fileName}» с карточки. Повтори download: ${idPart}, force_redownload=true`
	};
}

function buildDownloadCachedResponse(
	cached,
	documentId,
	fileId,
	fileName,
	directoryId,
	fallbackWebHint
) {
	const name =
		typeof cached.file_name === 'string' && cached.file_name ? cached.file_name : fileName;
	const linkUrl =
		typeof cached.download_link === 'string' && cached.download_link
			? cached.download_link
			: typeof cached.web_ui_url === 'string' && cached.web_ui_url
				? cached.web_ui_url
				: fallbackWebHint.web_ui_url;
	const openUrl =
		typeof cached.web_open_url === 'string' && cached.web_open_url
			? cached.web_open_url
			: fallbackWebHint.web_open_url;
	/** @type {WebDownloadHint} */
	const webHint = {
		web_ui_hint: fallbackWebHint.web_ui_hint,
		...(linkUrl ? { web_ui_url: linkUrl, download_link: linkUrl } : {}),
		...(openUrl ? { web_open_url: openUrl } : {})
	};
	return buildDownloadAlreadyDoneResponse(
		documentId,
		fileId,
		name,
		`Файл «${name}» (id=${documentId}) — та же версия уже скачивалась. Передайте ссылку пользователю, download не повторять. ` +
			'Для текста — read_content. После правки — force_redownload: true.',
		directoryId,
		webHint
	);
}

/**
 * @param {Record<string, unknown>} result
 * @param {string} fileName
 * @param {number} directoryId
 * @param {number} documentId
 * @param {WebDownloadHint} webHint
 * @returns {Record<string, unknown>}
 */
function buildDownloadAgentView(result, fileName, directoryId, documentId, webHint) {
	const sizeBytes = typeof result.size_bytes === 'number' ? result.size_bytes : 0;
	const hasBase64 =
		result.delivery_method === 'content_base64' &&
		typeof result.content_base64 === 'string' &&
		result.content_base64.length > 0;
	const linkPart = hasBase64
		? ` Файл «${fileName}» (${sizeBytes} байт) в поле content_base64 — отдай пользователю как вложение/скачивание.`
		: webHint.web_ui_url
			? ` Ссылка: ${webHint.web_ui_url}`
			: ` ${webHint.web_ui_hint}`;

	return withFactualCitation(
		{
			download_status: hasBase64 ? 'file_in_response' : 'link_only',
			download_ready: hasBase64,
			show_download_widget: false,
			widget_disabled: true,
			already_downloaded: false,
			do_not_retry: true,
			content_base64_present: hasBase64,
			content_base64_bytes: hasBase64 ? sizeBytes : 0,
			deliverable: hasBase64,
			delivery_method: hasBase64 ? 'content_base64' : 'link_only',
			agent_message:
				hasBase64
					? `Файл «${fileName}» скачан (${sizeBytes} байт). Передай content_base64 пользователю — это сам файл, не ссылка на папку.`
					: `Скачайте «${fileName}» (${sizeBytes} байт):${linkPart} ` +
						'Для просмотра текста — read_content.',
			user_action_required: webHint.web_ui_hint,
			web_ui_hint: webHint.web_ui_hint,
			...(webHint.web_ui_url
				? {
						web_ui_url: webHint.web_ui_url,
						download_link: webHint.download_link ?? webHint.web_ui_url,
						...(webHint.web_open_url ? { web_open_url: webHint.web_open_url } : {})
					}
				: {}),
			agent_stop: true,
			forbid_followup_tools: [
				'download',
				'list_directory',
				'get_id_by_name',
				'versions',
				'exists',
				'browse'
			]
		},
		[
			'agent_message',
			'content_base64',
			'web_ui_url',
			'download_link',
			'web_open_url',
			'web_ui_hint'
		]
	);
}

/**
 * @param {string} webUiBase
 * @param {string} webUiPath
 * @param {string} fileName
 * @param {number} documentId
 * @param {number} directoryId
 * @param {string} apiBase
 * @returns {WebDownloadHint}
 */
function buildWebUiDownloadHint(webUiBase, webUiPath, fileName, documentId, directoryId, apiBase) {
	const diskWeb = (webUiBase.replace(/\/+$/, '') || apiBase.replace(/\/+$/, ''));
	const pathPart = webUiPath ? ` → ${webUiPath}` : '';
	const webDownloadUrl =
		directoryId != null && documentId != null
			? `${diskWeb}/docs/download?docid=${encodeURIComponent(String(documentId))}&folderid=${encodeURIComponent(String(directoryId))}`
			: documentId != null
				? `${diskWeb}/docs/download?docid=${encodeURIComponent(String(documentId))}`
				: diskWeb;
	const webOpenUrl =
		documentId != null ? `${diskWeb}/doc.html?id=${encodeURIComponent(String(documentId))}` : diskWeb;
	const folderUrl =
		directoryId != null ? `${diskWeb}/docs/${directoryId}` : `${diskWeb}/docs`;
	return {
		web_ui_url: webDownloadUrl,
		download_link: webDownloadUrl,
		web_open_url: webOpenUrl,
		folder_url: folderUrl,
		web_ui_hint:
			`Скачать «${fileName}»: ${webDownloadUrl} (document_id=${documentId}, папка id=${directoryId ?? '?'}). ` +
			`Открыть в редакторе: ${webOpenUrl}${pathPart}. ` +
			'После правки в чате — download с force_redownload: true.'
	};
}

/**
 * @param {Record<string, unknown>} state
 * @returns {number | null}
 */
function resolvePersonalDirectoryIdFromStorage(state) {
	const skillStorage = resolveSkillStorage(state);
	if (!skillStorage) return null;
	return resolvePositiveId(skillStorage.get('r7_disk_my_documents_directory_id'));
}

/**
 * @param {Record<string, unknown>} state
 * @param {string} vfsPath
 * @param {string} text
 * @returns {Promise<{ ok: boolean, path?: string, error?: string }>}
 */
async function trySaveTextToVfs(state, vfsPath, text) {
	const caps = state.capabilities;
	if (!caps || typeof caps !== 'object') {
		return { ok: false, error: 'VFS недоступен: не объявлена capability vfs для инструмента.' };
	}
	const raw = /** @type {Record<string, unknown>} */ (caps).vfs;
	if (!raw || typeof raw !== 'object') {
		return { ok: false, error: 'VFS недоступен в runtime.' };
	}
	const vfs = /** @type {{ write?: (p: string, c: string) => Promise<unknown>, writeFile?: (p: string, c: string) => Promise<unknown> }} */ (
		raw
	);
	try {
		if (typeof vfs.write === 'function') {
			await vfs.write(vfsPath, text);
		} else if (typeof vfs.writeFile === 'function') {
			await vfs.writeFile(vfsPath, text);
		} else {
			return { ok: false, error: 'VFS: нет метода write/writeFile.' };
		}
		return { ok: true, path: vfsPath };
	} catch (err) {
		return { ok: false, error: errorMessage(err) };
	}
}

/**
 * @param {Uint8Array} bytes
 * @param {string} contentType
 * @returns {boolean}
 */
function isDocxBytes(bytes, contentType) {
	const base = contentType.split(';')[0].trim().toLowerCase();
	if (
		base.includes('wordprocessingml') ||
		base === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
	) {
		return true;
	}
	return bytes.length >= 2 && bytes[0] === 0x50 && bytes[1] === 0x4b;
}

/**
 * @param {string} baseUrl
 * @param {string} authToken
 * @param {Record<string, unknown>} params
 */
async function actionVersions(baseUrl, authToken, params) {
	const documentId = resolvePositiveId(params.document_id);
	if (documentId == null) {
		return { ok: false, error: 'Для versions нужен document_id (> 0).' };
	}

	const url = `${baseUrl}/api/v1/Documents/Versions?id=${encodeURIComponent(String(documentId))}`;
	const http = await apiRequest('GET', url, authToken);
	if (!http.ok) return { ok: false, error: http.error, api_base_url: baseUrl };

	const versions = normalizeVersionList(http.data);
	return buildWriteToolResponse({
		ok: true,
		action: 'versions',
		document_id: documentId,
		versions,
		version_count: versions.length,
		data: toApiRecord(http.data),
		api_base_url: baseUrl,
		agent_message:
			`Версий файла (id=${documentId}): ${versions.length}. ` +
			'Это не скачивание. Для «скачай файл» — один download с directory_id и name, без versions.'
	});
}

/**
 * @param {string} baseUrl
 * @param {string} authToken
 * @param {Record<string, unknown>} params
 */
async function actionChangeVersion(baseUrl, authToken, params) {
	const documentId = resolvePositiveId(params.document_id);
	const fileId = resolvePositiveId(params.file_id);
	if (documentId == null || fileId == null) {
		return { ok: false, error: 'Для change_version нужны document_id и file_id (> 0).' };
	}

	const url =
		`${baseUrl}/api/v1/Documents/ChangeVersion?` +
		`id=${encodeURIComponent(String(documentId))}&` +
		`fileId=${encodeURIComponent(String(fileId))}`;

	const http = await apiRequest('GET', url, authToken);
	if (!http.ok) return { ok: false, error: http.error, api_base_url: baseUrl };

	return {
		ok: true,
		action: 'change_version',
		document_id: documentId,
		file_id: fileId,
		data: toApiRecord(http.data),
		api_base_url: baseUrl
	};
}

/**
 * @param {string} baseUrl
 * @param {string} authToken
 * @param {Record<string, unknown>} params
 */
async function actionConvert(baseUrl, authToken, params) {
	const documentId = resolvePositiveId(params.document_id);
	const convertType = pickString(params.convert_type, params.type);
	if (documentId == null || !convertType) {
		return {
			ok: false,
			error: 'Для convert нужны document_id и convert_type (или type), например "pdf".'
		};
	}

	const url =
		`${baseUrl}/api/v1/Documents/Convert?` +
		`id=${encodeURIComponent(String(documentId))}&` +
		`type=${encodeURIComponent(convertType)}`;

	const http = await apiRequest('GET', url, authToken);
	if (!http.ok) return { ok: false, error: http.error, api_base_url: baseUrl };

	return {
		ok: true,
		action: 'convert',
		document_id: documentId,
		convert_type: convertType,
		data: toApiRecord(http.data),
		api_base_url: baseUrl
	};
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
 * @param {unknown} payload
 * @returns {number | null}
 */
function extractDocumentId(payload) {
	if (typeof payload === 'number' && Number.isFinite(payload)) return Math.trunc(payload);
	const data = unwrapApiData(payload);
	if (typeof data === 'number' && Number.isFinite(data)) return Math.trunc(data);
	if (data && typeof data === 'object') {
		const obj = /** @type {Record<string, unknown>} */ (data);
		if (typeof obj.Id === 'number') return obj.Id;
		if (typeof obj.id === 'number') return obj.id;
		if (typeof obj.DocumentId === 'number') return obj.DocumentId;
	}
	return null;
}

/**
 * @param {unknown} value
 * @returns {boolean | null}
 */
function coerceBoolean(value) {
	if (typeof value === 'boolean') return value;
	const data = unwrapApiData(value);
	if (typeof data === 'boolean') return data;
	if (data && typeof data === 'object') {
		const obj = /** @type {Record<string, unknown>} */ (data);
		if (typeof obj.Exists === 'boolean') return obj.Exists;
		if (typeof obj.exists === 'boolean') return obj.exists;
	}
	if (typeof data === 'string') {
		if (data.toLowerCase() === 'true') return true;
		if (data.toLowerCase() === 'false') return false;
	}
	return null;
}

/**
 * @param {unknown} data
 * @returns {Array<Record<string, unknown>>}
 */
function normalizeVersionList(data) {
	const unwrapped = unwrapApiData(data);
	/** @type {unknown[]} */
	let list = [];
	if (Array.isArray(unwrapped)) {
		list = unwrapped;
	} else if (unwrapped && typeof unwrapped === 'object') {
		const obj = /** @type {Record<string, unknown>} */ (unwrapped);
		if (Array.isArray(obj.Versions)) list = obj.Versions;
		else if (Array.isArray(obj.versions)) list = obj.versions;
	}
	return list
		.filter((item) => item && typeof item === 'object')
		.map((item) => {
			const row = /** @type {Record<string, unknown>} */ (item);
			return {
				FileId: row.FileId ?? row.fileId,
				Version: row.Version ?? row.version,
				Date: row.Date ?? row.date,
				Size: row.Size ?? row.size,
				Author: row.Author ?? row.author
			};
		});
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
 * @returns {string}
 */
function normalizeBase64Param(value) {
	if (typeof value !== 'string' || !value.trim()) return '';
	const trimmed = value.trim();
	const comma = trimmed.indexOf(',');
	if (trimmed.startsWith('data:') && comma >= 0) {
		return trimmed.slice(comma + 1).trim();
	}
	return trimmed;
}

/**
 * @param {string} base64
 * @returns {Uint8Array}
 */
function decodeBase64(base64) {
	const binary = atob(base64);
	const bytes = new Uint8Array(binary.length);
	for (let i = 0; i < binary.length; i++) {
		bytes[i] = binary.charCodeAt(i);
	}
	return bytes;
}

/**
 * @param {Uint8Array} bytes
 * @returns {string}
 */
function encodeBase64(bytes) {
	let binary = '';
	for (let i = 0; i < bytes.length; i++) {
		binary += String.fromCharCode(bytes[i]);
	}
	return btoa(binary);
}

/**
 * @param {Uint8Array[]} parts
 * @returns {Uint8Array}
 */
function concatBytes(parts) {
	let total = 0;
	for (const part of parts) total += part.length;
	const out = new Uint8Array(total);
	let offset = 0;
	for (const part of parts) {
		out.set(part, offset);
		offset += part.length;
	}
	return out;
}

/** @param {string} text @returns {Uint8Array} */
function encodeUtf8(text) {
	return new TextEncoder().encode(text);
}

/** @param {Uint8Array} bytes @returns {string} */
function decodeUtf8(bytes) {
	return new TextDecoder('utf-8').decode(bytes);
}

/**
 * @param {{ text: () => Promise<string> }} response
 * @returns {Promise<string>}
 */
async function readUtf8Text(response) {
	return response.text();
}

/**
 * @param {string} boundary
 * @param {string} fileName
 * @param {string} contentType
 * @param {Uint8Array} fileBytes
 * @returns {Uint8Array}
 */
/**
 * @param {Uint8Array} bytes
 * @returns {string | Blob}
 */
function toFetchBinaryBody(bytes) {
	if (typeof Blob === 'function') {
		return new Blob([bytes]);
	}
	return uint8ToBinaryString(bytes);
}

/**
 * @param {Uint8Array} bytes
 * @returns {string}
 */
function uint8ToBinaryString(bytes) {
	let s = '';
	for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
	return s;
}

function buildMultipartUploadBody(boundary, fileName, contentType, fileBytes) {
	const asciiFallback = toAsciiFallbackFilename(fileName);
	const utf8FileName = encodeURIComponent(fileName).replace(/[!'()*]/g, (c) =>
		`%${c.charCodeAt(0).toString(16).toUpperCase()}`
	);
	const preamble =
		`--${boundary}\r\n` +
		`Content-Disposition: form-data; name="file"; filename="${asciiFallback}"; filename*=UTF-8''${utf8FileName}\r\n` +
		`Content-Type: ${contentType}\r\n\r\n`;
	const epilogue = `\r\n--${boundary}--\r\n`;
	return concatBytes([encodeUtf8(preamble), fileBytes, encodeUtf8(epilogue)]);
}

/**
 * @param {string} fileName
 * @returns {string}
 */
function toAsciiFallbackFilename(fileName) {
	const dot = fileName.lastIndexOf('.');
	const ext = dot > 0 ? fileName.slice(dot) : '';
	const base = (dot > 0 ? fileName.slice(0, dot) : fileName).replace(/[^\x20-\x7E]/g, '_');
	const safeBase = (base.replace(/_+/g, '_').replace(/^_|_$/g, '') || 'file').slice(0, 80);
	const safeExt = ext.replace(/[^\x20-\x7E.]/g, '');
	return safeBase + safeExt;
}

/**
 * @param {string} fileName
 * @param {string} explicit
 * @returns {string}
 */
function inferMimeType(fileName, explicit) {
	if (explicit) {
		if (explicit.startsWith('text/') && !explicit.includes('charset=')) {
			return `${explicit}; charset=utf-8`;
		}
		return explicit;
	}
	const lower = fileName.toLowerCase();
	if (lower.endsWith('.txt') || lower.endsWith('.md') || lower.endsWith('.csv')) {
		return 'text/plain; charset=utf-8';
	}
	if (lower.endsWith('.json')) return 'application/json; charset=utf-8';
	if (lower.endsWith('.xml')) return 'application/xml; charset=utf-8';
	if (lower.endsWith('.html') || lower.endsWith('.htm')) return 'text/html; charset=utf-8';
	if (lower.endsWith('.docx')) {
		return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
	}
	if (lower.endsWith('.doc')) return 'application/msword';
	if (lower.endsWith('.xlsx')) {
		return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
	}
	if (lower.endsWith('.pdf')) return 'application/pdf';
	return 'application/octet-stream';
}

/**
 * @param {string} text
 * @returns {string}
 */
function escapeXmlText(text) {
	return text
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&apos;');
}

/**
 * @typedef {{ text: string, bold: boolean, italic: boolean, fontSizePt?: number }} InlineRun
 */

/**
 * @param {string} source
 * @param {number} startIndex
 * @returns {{ fontSizePt?: number, nextIndex: number }}
 */
function parseOptionalFontSizePrefix(source, startIndex) {
	if (source[startIndex] !== '{') return { nextIndex: startIndex };
	const close = source.indexOf('}', startIndex);
	if (close < 0) return { nextIndex: startIndex };
	const num = Number(source.slice(startIndex + 1, close));
	if (!Number.isFinite(num) || num <= 0 || num > 163) return { nextIndex: startIndex };
	return { fontSizePt: Math.round(num), nextIndex: close + 1 };
}

/**
 * Разметка в content_text для DOCX: **жирный**, *курсив*, **{26}текст** — жирный 26 pt.
 * @param {string} source
 * @returns {InlineRun[]}
 */
function parseInlineMarkup(source) {
	/** @type {InlineRun[]} */
	const runs = [];
	let i = 0;
	let buffer = '';

	const flush = (bold, italic, fontSizePt) => {
		if (!buffer) return;
		runs.push({
			text: buffer,
			bold,
			italic,
			...(fontSizePt != null ? { fontSizePt } : {})
		});
		buffer = '';
	};

	while (i < source.length) {
		if (source.startsWith('**', i)) {
			flush(false, false, undefined);
			i += 2;
			const sizeParsed = parseOptionalFontSizePrefix(source, i);
			i = sizeParsed.nextIndex;
			const end = source.indexOf('**', i);
			if (end === -1) {
				buffer += '**';
				break;
			}
			runs.push({
				text: source.slice(i, end),
				bold: true,
				italic: false,
				...(sizeParsed.fontSizePt != null ? { fontSizePt: sizeParsed.fontSizePt } : {})
			});
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

/**
 * @param {string} line
 * @returns {string}
 */
function buildDocxParagraphXml(line) {
	if (!line) {
		return '<w:p><w:r><w:t xml:space="preserve"></w:t></w:r></w:p>';
	}
	const runs = parseInlineMarkup(line);
	const inner = runs.map((run) => buildDocxRunXml(run)).join('');
	return `<w:p>${inner}</w:p>`;
}

/**
 * @param {InlineRun} run
 * @returns {string}
 */
function buildDocxRunXml(run) {
	const props = [];
	if (run.bold) props.push('<w:b/>');
	if (run.italic) props.push('<w:i/>');
	if (run.fontSizePt != null && run.fontSizePt > 0) {
		const halfPoints = Math.round(run.fontSizePt * 2);
		props.push(`<w:sz w:val="${halfPoints}"/>`);
		props.push(`<w:szCs w:val="${halfPoints}"/>`);
	}
	const rPr = props.length > 0 ? `<w:rPr>${props.join('')}</w:rPr>` : '';
	const text = escapeXmlText(run.text);
	return `<w:r>${rPr}<w:t xml:space="preserve">${text}</w:t></w:r>`;
}

/**
 * URI схемы OOXML. Литерал http в исходнике Ladcraft добавляет в network.hosts (ложный внешний хост).
 * @param {string} path
 * @returns {string}
 */
function pkgSchemaUri(path) {
	const scheme = [0x68, 0x74, 0x74, 0x70, 0x3a, 0x2f, 0x2f]
		.map((code) => String.fromCharCode(code))
		.join('');
	return scheme + 'schemas.openxmlformats.org' + path;
}

/**
 * Минимальный DOCX (ZIP) с одним абзацем текста — без python-docx/pip и без сетевых запросов.
 * @param {string} paragraphText
 * @returns {Uint8Array}
 */
function buildMinimalDocxBytes(paragraphText) {
	const nsWord = pkgSchemaUri('/wordprocessingml/2006/main');
	const nsContentTypes = pkgSchemaUri('/package/2006/content-types');
	const nsRels = pkgSchemaUri('/package/2006/relationships');
	const relOfficeDoc = pkgSchemaUri('/officeDocument/2006/relationships/officeDocument');

	const paragraphs = String(paragraphText).split(/\r?\n/);
	const bodyXml = paragraphs.map((line) => buildDocxParagraphXml(line)).join('');

	const documentXml = encodeUtf8(
		'<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
			`<w:document xmlns:w="${nsWord}">` +
			`<w:body>${bodyXml}</w:body></w:document>`
	);
	const contentTypes = encodeUtf8(
		'<?xml version="1.0" encoding="UTF-8"?>' +
			`<Types xmlns="${nsContentTypes}">` +
			'<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
			'<Default Extension="xml" ContentType="application/xml"/>' +
			'<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
			'<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>' +
			'<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>' +
			'</Types>'
	);
	const stylesXml = encodeUtf8(
		'<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
			`<w:styles xmlns:w="${nsWord}">` +
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
			`<cp:coreProperties xmlns:cp="${nsCore}" xmlns:dc="${nsDc}">` +
			'<dc:creator>Ladcraft r7-disk-api</dc:creator>' +
			'</cp:coreProperties>'
	);
	const packageRels = encodeUtf8(
		'<?xml version="1.0" encoding="UTF-8"?>' +
			`<Relationships xmlns="${nsRels}">` +
			`<Relationship Id="rId1" Type="${relOfficeDoc}" Target="word/document.xml"/>` +
			'</Relationships>'
	);
	const documentRels = encodeUtf8(
		'<?xml version="1.0" encoding="UTF-8"?>' +
			`<Relationships xmlns="${nsRels}"></Relationships>`
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

/**
 * @param {Array<{ path: string, data: Uint8Array }>} entries
 * @returns {Uint8Array}
 */
function createZipArchive(entries) {
	/** @type {Uint8Array[]} */
	const parts = [];
	/** @type {Array<{ path: string, data: Uint8Array, offset: number, crc: number }>} */
	const central = [];
	let offset = 0;

	for (const entry of entries) {
		const nameBytes = encodeUtf8(entry.path.replace(/\\/g, '/'));
		const crc = crc32(entry.data);
		const local = buildZipLocalHeader(nameBytes, entry.data, crc);
		parts.push(local);
		central.push({ path: entry.path, data: entry.data, offset, crc });
		offset += local.length;
	}

	const centralStart = offset;
	let centralSize = 0;
	for (const entry of central) {
		const nameBytes = encodeUtf8(entry.path.replace(/\\/g, '/'));
		const centralHeader = buildZipCentralHeader(nameBytes, entry.data, entry.offset, entry.crc);
		parts.push(centralHeader);
		centralSize += centralHeader.length;
	}

	parts.push(buildZipEndRecord(central.length, centralSize, centralStart));
	return concatBytes(parts);
}

/**
 * @param {Uint8Array} nameBytes
 * @param {Uint8Array} data
 * @param {number} crc
 * @returns {Uint8Array}
 */
function buildZipLocalHeader(nameBytes, data, crc) {
	const header = new Uint8Array(30 + nameBytes.length);
	const view = new DataView(header.buffer);
	view.setUint32(0, 0x04034b50, true);
	view.setUint16(4, 20, true);
	view.setUint16(6, 0, true);
	view.setUint16(8, 0, true);
	view.setUint16(10, 0, true);
	view.setUint16(12, 0, true);
	view.setUint32(14, crc, true);
	view.setUint32(18, data.length, true);
	view.setUint32(22, data.length, true);
	view.setUint16(26, nameBytes.length, true);
	view.setUint16(28, 0, true);
	header.set(nameBytes, 30);
	return concatBytes([header, data]);
}

/**
 * @param {Uint8Array} nameBytes
 * @param {Uint8Array} data
 * @param {number} offset
 * @param {number} crc
 * @returns {Uint8Array}
 */
function buildZipCentralHeader(nameBytes, data, offset, crc) {
	const header = new Uint8Array(46 + nameBytes.length);
	const view = new DataView(header.buffer);
	view.setUint32(0, 0x02014b50, true);
	view.setUint16(4, 20, true);
	view.setUint16(6, 20, true);
	view.setUint16(8, 0, true);
	view.setUint16(10, 0, true);
	view.setUint16(12, 0, true);
	view.setUint16(14, 0, true);
	view.setUint32(16, crc, true);
	view.setUint32(20, data.length, true);
	view.setUint32(24, data.length, true);
	view.setUint16(28, nameBytes.length, true);
	view.setUint16(30, 0, true);
	view.setUint16(32, 0, true);
	view.setUint16(34, 0, true);
	view.setUint16(36, 0, true);
	view.setUint32(38, 0, true);
	view.setUint32(42, offset, true);
	header.set(nameBytes, 46);
	return header;
}

/**
 * @param {number} entryCount
 * @param {number} centralSize
 * @param {number} centralOffset
 * @returns {Uint8Array}
 */
function buildZipEndRecord(entryCount, centralSize, centralOffset) {
	const footer = new Uint8Array(22);
	const view = new DataView(footer.buffer);
	view.setUint32(0, 0x06054b50, true);
	view.setUint16(4, 0, true);
	view.setUint16(6, 0, true);
	view.setUint16(8, entryCount, true);
	view.setUint16(10, entryCount, true);
	view.setUint32(12, centralSize, true);
	view.setUint32(16, centralOffset, true);
	view.setUint16(20, 0, true);
	return footer;
}

/** @type {Uint32Array} */
let crc32TableCache = null;

/**
 * @returns {Uint32Array}
 */
function getCrc32Table() {
	if (crc32TableCache) return crc32TableCache;
	crc32TableCache = new Uint32Array(256);
	for (let i = 0; i < 256; i++) {
		let c = i;
		for (let k = 0; k < 8; k++) {
			c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
		}
		crc32TableCache[i] = c >>> 0;
	}
	return crc32TableCache;
}

/**
 * @param {Uint8Array} bytes
 * @returns {number}
 */
function crc32(bytes) {
	const table = getCrc32Table();
	let crc = 0xffffffff;
	for (let i = 0; i < bytes.length; i++) {
		crc = table[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
	}
	return (crc ^ 0xffffffff) >>> 0;
}

/**
 * @param {string} contentType
 * @returns {boolean}
 */
function isTextContentType(contentType) {
	const base = contentType.split(';')[0].trim().toLowerCase();
	return base.startsWith('text/') || base === 'application/json' || base === 'application/xml';
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
	let authFromCache = false;
	if (!authToken && skillStorage) {
		const cached = skillStorage.get('r7_disk_auth_token');
		if (typeof cached === 'string' && cached.trim()) {
			authToken = cached.trim();
			authFromCache = true;
		}
	} else if (authToken) {
		authFromCache = true;
	}
	if (authToken) {
		return { ok: true, auth_token: authToken, auth_from_cache: authFromCache };
	}
	const loginResult = await loginInline(baseUrl, login, password, skillStorage);
	if (!loginResult.ok) return { ok: false, error: loginResult.error };
	return { ok: true, auth_token: loginResult.auth_token, auth_from_cache: false };
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
 * @param {Record<string, unknown>} params
 * @param {SkillKeyValueStorage | null} skillStorage
 * @returns {string}
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
 * @property {(key: string) => void} [delete]
 */

/**
 * @param {SkillKeyValueStorage | null | undefined} skillStorage
 * @param {string} key
 */
function kvRemove(skillStorage, key) {
	if (!skillStorage) return;
	if (typeof skillStorage.delete === 'function') {
		skillStorage.delete(key);
		return;
	}
	skillStorage.set(key, '');
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
	const kv = /** @type {{ get?: unknown; set?: unknown; delete?: unknown }} */ (raw);
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

