async function handler(state, params) {
	const warnings = [];
	const userEnv = readUserEnv(state);
	const skillStorage = resolveSkillStorage(state);
	const baseUrl = resolveBaseUrl(state, params, skillStorage);
	const login = pickString(params?.login, userEnv.R7_DISK_LOGIN);
	const password = pickString(params?.password, userEnv.R7_DISK_PASSWORD);
	if (!baseUrl) {
		return fail('Не задан R7_DISK_BASE_URL.', warnings);
	}

	const authResult = await ensureAuthToken(
		baseUrl,
		login,
		password,
		skillStorage,
		params?.auth_token
	);
	if (!authResult.ok) {
		return fail(authResult.error, warnings);
	}
	const authToken = authResult.auth_token;

	const templateDirectoryId = resolvePositiveId(
		params?.template_directory_id ?? userEnv.R7_DISK_GOST34_TEMPLATE_DIRECTORY_ID
	);
	const resultDirectoryId = resolvePositiveId(
		params?.result_directory_id ?? userEnv.R7_DISK_GOST34_RESULT_DIRECTORY_ID
	);
	const inputDirectoryId = resolvePositiveId(params?.input_directory_id);
	const templateName = pickString(
		params?.template_name,
		userEnv.R7_DISK_GOST34_TEMPLATE_NAME || 'gost34_task_description_template.docx'
	);
	const inputName = pickString(params?.input_name, params?.name);
	const outputName = buildOutputName(params?.output_name, inputName);

	if (templateDirectoryId == null) {
		return fail(
			'Не задан template_directory_id (или R7_DISK_GOST34_TEMPLATE_DIRECTORY_ID).',
			warnings
		);
	}
	if (resultDirectoryId == null) {
		return fail(
			'Не задан result_directory_id (или R7_DISK_GOST34_RESULT_DIRECTORY_ID).',
			warnings
		);
	}
	if (inputDirectoryId == null || !inputName) {
		return fail('Нужны input_directory_id и input_name.', warnings);
	}

	if (!getZlib()) {
		return fail('Для DOCX-обработки нужен zlib в runtime.', warnings);
	}

	const templateLookup = await getDocumentIdByName(baseUrl, authToken, templateDirectoryId, templateName);
	if (!templateLookup.ok || templateLookup.documentId == null) {
		return fail(
			`Шаблон «${templateName}» не найден в папке template_directory_id=${templateDirectoryId}.`,
			warnings
		);
	}
	const inputLookup = await getDocumentIdByName(baseUrl, authToken, inputDirectoryId, inputName);
	if (!inputLookup.ok || inputLookup.documentId == null) {
		return fail(
			`Входной файл «${inputName}» не найден в папке input_directory_id=${inputDirectoryId}.`,
			warnings
		);
	}

	const templateDownloaded = await downloadDocumentBytes(baseUrl, authToken, templateLookup.documentId);
	if (!templateDownloaded.ok) {
		return fail(`Не удалось скачать шаблон: ${templateDownloaded.error}`, warnings);
	}
	const inputDownloaded = await downloadDocumentBytes(baseUrl, authToken, inputLookup.documentId);
	if (!inputDownloaded.ok) {
		return fail(`Не удалось скачать входной файл: ${inputDownloaded.error}`, warnings);
	}

	const templateCheck = validateTemplateBytes(templateDownloaded.bytes, templateName);
	if (!templateCheck.ok) {
		return fail(templateCheck.error, warnings);
	}

	const inputBytes = inputDownloaded.bytes;
	const inputText = extractTextByName(inputName, inputBytes);
	if (!inputText.trim()) {
		warnings.push(
			'Не удалось извлечь достаточно текста из входного файла. Часть секций может быть заполнена заглушками.'
		);
	}
	const projectName = pickString(params?.projectName, params?.project_name);
	const inputParagraphs = extractDocumentParagraphs(inputBytes);
	const inputSectionMap = buildSemanticGostMap(inputParagraphs, projectName);
	mergeSectionMaps(inputSectionMap, buildSectionMapFromParagraphs(inputParagraphs));
	mergeLegacySectionsIntoMap(
		inputSectionMap,
		normalizeTaskDescriptionContent(extractDocxPlainText(inputBytes), projectName)
	);
	const inferredTitle = inferTitleMetaFromInput(inputParagraphs, projectName);
	const meta = {
		systemName:
			projectName ||
			inferredTitle.systemName ||
			inputSectionMap.__title__ ||
			'Заполнить.',
		cipher:
			pickString(params?.cipher, '') || inferredTitle.cipher || 'Заполнить.',
		organization:
			pickString(params?.organization, '') || inferredTitle.organization || 'Заполнить.'
	};

	let outputBytes;
	let fillStats = { filled: 0, missing: 0 };
	let recommendations = [];
	try {
		const built = buildDocxFromTemplate(templateDownloaded.bytes, inputSectionMap, meta);
		outputBytes = built.bytes;
		fillStats = built.fillStats;
		recommendations = built.recommendations;
		warnings.push(
			'Применён шаблон «Описание постановки задачи (комплекса задач)» с сохранением оформления и инженерной рамки.'
		);
	} catch (error) {
		return fail(`Не удалось применить шаблон ГОСТ34: ${errorMessage(error)}`, warnings);
	}

	const conflictPolicy = pickString(params?.conflict_policy, 'suffix').toLowerCase();
	const finalOutputName = await resolveOutputNameByPolicy(
		baseUrl,
		authToken,
		resultDirectoryId,
		outputName,
		conflictPolicy
	);
	if (!finalOutputName.ok) {
		return fail(finalOutputName.error, warnings);
	}

	const uploaded = await performMultipartUpload(
		baseUrl,
		authToken,
		resultDirectoryId,
		finalOutputName.name,
		outputBytes,
		'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
	);
	if (!uploaded.ok) {
		return fail(`Не удалось загрузить результат: ${uploaded.error}`, warnings);
	}

	warnings.push(
		'Документ сформирован по шаблону ГОСТ34 из папки templates и загружен в папку results. Скачивайте оригинальный DOCX из Р7-Диска (не упрощённую копию).'
	);
	if (fillStats.missing > 0) {
		warnings.push(
			`Не заполнено секций: ${fillStats.missing}. В документ добавлены пометки «Необходимо добавить текст».`
		);
	}

	return {
		ok: true,
		operation: 'gost34_generate',
		base_url: baseUrl,
		template_directory_id: templateDirectoryId,
		template_name: templateName,
		template_document_id: templateLookup.documentId,
		input_directory_id: inputDirectoryId,
		input_name: inputName,
		input_document_id: inputLookup.documentId,
		result_directory_id: resultDirectoryId,
		output_name: finalOutputName.name,
		output_document_id: uploaded.document_id,
		output_size_bytes: outputBytes.length,
		filledSlots: fillStats.filled,
		missingSlots: fillStats.missing,
		recommendations,
		warnings,
		agent_message:
			`ГОСТ34-документ «${finalOutputName.name}» создан в папке id=${resultDirectoryId}. ` +
			'Если есть рекомендации, внесите недостающий текст по разделам.'
	};
}

function fail(message, warnings) {
	return {
		ok: false,
		operation: 'gost34_generate',
		error: message,
		warnings: warnings.concat([message]),
		recommendations: [],
		filledSlots: 0,
		missingSlots: 0
	};
}

function buildOutputName(rawOutputName, inputName) {
	const custom = pickString(rawOutputName, '');
	if (custom) return ensureDocxExtension(custom);
	const base = stripExtension(inputName || 'document');
	return ensureDocxExtension(`${sanitizeFileName(base)}_gost34_postanovka.docx`);
}

function ensureDocxExtension(name) {
	const trimmed = String(name || '').trim();
	return /\.docx$/i.test(trimmed) ? trimmed : `${trimmed}.docx`;
}

async function resolveOutputNameByPolicy(baseUrl, authToken, directoryId, name, policy) {
	const exists = await getDocumentIdByName(baseUrl, authToken, directoryId, name);
	if (!exists.ok) return { ok: true, name };
	if (exists.documentId == null) return { ok: true, name };
	if (policy === 'overwrite') {
		await deleteDocument(baseUrl, authToken, exists.documentId);
		return { ok: true, name };
	}
	if (policy === 'error') {
		return { ok: false, error: `Файл «${name}» уже существует в папке результатов.` };
	}
	const stamped = stampOutputName(name);
	return { ok: true, name: stamped };
}

function stampOutputName(name) {
	const dot = name.lastIndexOf('.');
	const base = dot > 0 ? name.slice(0, dot) : name;
	const ext = dot > 0 ? name.slice(dot) : '.docx';
	const now = new Date();
	const stamp =
		String(now.getFullYear()) +
		String(now.getMonth() + 1).padStart(2, '0') +
		String(now.getDate()).padStart(2, '0') +
		'_' +
		String(now.getHours()).padStart(2, '0') +
		String(now.getMinutes()).padStart(2, '0') +
		String(now.getSeconds()).padStart(2, '0');
	return `${base}_${stamp}${ext}`;
}

function stripExtension(path) {
	const lastSlash = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'));
	const lastDot = path.lastIndexOf('.');
	if (lastDot > lastSlash) {
		return path.slice(0, lastDot);
	}
	return path;
}

function sanitizeFileName(name) {
	return String(name || '')
		.trim()
		.replace(/[<>:"|?*\u0000-\u001f]/g, '_')
		.replace(/\s+/g, ' ')
		.slice(0, 120);
}

function extractTextByName(fileName, bytes) {
	const lower = String(fileName || '').toLowerCase();
	if (lower.endsWith('.docx')) {
		return extractDocxPlainText(bytes);
	}
	if (lower.endsWith('.txt') || lower.endsWith('.md') || lower.endsWith('.csv') || lower.endsWith('.json')) {
		return decodeUtf8(bytes);
	}
	if (looksLikeZip(bytes)) {
		return extractDocxPlainText(bytes);
	}
	return decodeUtf8(bytes);
}


async function getDocumentIdByName(baseUrl, authToken, directoryId, name) {
	const url =
		`${baseUrl}/api/v1/Documents/GetIdByName?` +
		`name=${encodeURIComponent(name)}&` +
		`directoryId=${encodeURIComponent(String(directoryId))}`;
	const http = await apiRequest('GET', url, authToken);
	if (!http.ok) return { ok: false, error: http.error };
	return { ok: true, documentId: extractDocumentId(http.data) };
}

async function deleteDocument(baseUrl, authToken, documentId) {
	const url = `${baseUrl}/api/v1/Documents/Delete`;
	return apiRequest('POST', url, authToken, { Ids: [documentId] });
}

async function downloadDocumentBytes(baseUrl, authToken, documentId) {
	const url =
		`${baseUrl}/api/v1/Documents/Download?` +
		`id=${encodeURIComponent(String(documentId))}`;
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
		return { ok: false, error: `Download HTTP ${response.status}: ${truncate(errText, 240)}` };
	}
	const buffer = await response.arrayBuffer();
	return { ok: true, bytes: new Uint8Array(buffer) };
}

async function performMultipartUpload(baseUrl, authToken, directoryId, fileName, fileBytes, mimeOverride) {
	const url = `${baseUrl}/api/v1/Documents/Upload`;
	const boundary = `----R7Disk${Date.now()}`;
	const contentType = mimeOverride || 'application/octet-stream';
	const bodyBytes = buildMultipartUploadBody(boundary, fileName, contentType, fileBytes);
	let response;
	try {
		response = await fetch(url, {
			method: 'POST',
			headers: {
				Authorization: authToken,
				DirectoryId: String(directoryId),
				'Content-Type': `multipart/form-data; boundary=${boundary}`
			},
			body: toFetchBinaryBody(bodyBytes)
		});
	} catch (err) {
		return { ok: false, error: `Сетевая ошибка upload: ${errorMessage(err)}` };
	}
	const rawText = await readUtf8Text(response);
	if (!response.ok) {
		return { ok: false, error: `Upload HTTP ${response.status}: ${truncate(rawText, 320)}` };
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
	return { ok: true, document_id: extractDocumentId(data), data };
}

function buildMultipartUploadBody(boundary, fileName, contentType, fileBytes) {
	const part1 =
		`--${boundary}\r\n` +
		`Content-Disposition: form-data; name="file"; filename="${escapeHeaderFileName(fileName)}"\r\n` +
		`Content-Type: ${contentType}\r\n\r\n`;
	const part2 = `\r\n--${boundary}--\r\n`;
	const head = encodeUtf8(part1);
	const tail = encodeUtf8(part2);
	const out = new Uint8Array(head.length + fileBytes.length + tail.length);
	out.set(head, 0);
	out.set(fileBytes, head.length);
	out.set(tail, head.length + fileBytes.length);
	return out;
}

function escapeHeaderFileName(name) {
	return String(name || 'file.docx').replace(/[\r\n"]/g, '_');
}

function toFetchBinaryBody(bytes) {
	return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
}

async function apiRequest(method, url, authToken, body = null) {
	const init = {
		method,
		headers: {
			'Content-Type': 'application/json; charset=utf-8',
			Accept: 'application/json; charset=utf-8',
			Authorization: authToken
		}
	};
	if (body != null) init.body = JSON.stringify(body);
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
			payload = rawText;
		}
	}
	if (!response.ok) return { ok: false, error: `HTTP ${response.status}: ${truncate(rawText, 280)}` };
	return { ok: true, data: unwrapApiData(payload) };
}

function unwrapApiData(payload) {
	if (payload && typeof payload === 'object' && 'Response' in payload) {
		const response = payload.Response;
		if (response && typeof response === 'object' && 'Data' in response) return response.Data ?? payload;
	}
	return payload;
}

function extractDocumentId(payload) {
	if (typeof payload === 'number' && Number.isFinite(payload)) return Math.trunc(payload);
	const data = unwrapApiData(payload);
	if (typeof data === 'number' && Number.isFinite(data)) return Math.trunc(data);
	if (data && typeof data === 'object') {
		if (typeof data.Id === 'number') return data.Id;
		if (typeof data.id === 'number') return data.id;
		if (typeof data.DocumentId === 'number') return data.DocumentId;
	}
	return null;
}

function resolvePositiveId(value) {
	if (typeof value === 'number' && Number.isFinite(value) && value > 0) return Math.trunc(value);
	if (typeof value === 'string' && value.trim()) {
		const parsed = Number(value.trim());
		if (Number.isFinite(parsed) && parsed > 0) return Math.trunc(parsed);
	}
	return null;
}

async function ensureAuthToken(baseUrl, login, password, skillStorage, authTokenParam) {
	let authToken = typeof authTokenParam === 'string' ? authTokenParam.trim() : '';
	if (!authToken && skillStorage) {
		const cached = skillStorage.get('r7_disk_auth_token');
		if (typeof cached === 'string' && cached.trim()) authToken = cached.trim();
	}
	if (authToken) return { ok: true, auth_token: authToken };
	return loginInline(baseUrl, login, password, skillStorage);
}

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
	if (!response.ok) return { ok: false, error: `Login HTTP ${response.status}: ${truncate(rawText, 240)}` };
	const authToken = payload?.Response?.Data?.Tokens?.AuthToken;
	if (typeof authToken !== 'string' || !authToken) return { ok: false, error: 'Login: AuthToken не найден.' };
	if (skillStorage) {
		skillStorage.set('r7_disk_auth_token', authToken);
		skillStorage.set('r7_disk_base_url', baseUrl);
	}
	return { ok: true, auth_token: authToken };
}

function readUserEnv(state) {
	const env = state.environment;
	if (!env || typeof env !== 'object') return {};
	const user = env.user;
	if (!user || typeof user !== 'object') return {};
	return user;
}

function resolveBaseUrl(state, params, skillStorage) {
	const userEnv = readUserEnv(state);
	const fromParam = typeof params?.base_url === 'string' ? params.base_url.trim() : '';
	if (fromParam) return fromParam.replace(/\/+$/, '');
	if (skillStorage) {
		const cached = skillStorage.get('r7_disk_base_url');
		if (typeof cached === 'string' && cached.trim()) return cached.trim().replace(/\/+$/, '');
	}
	return pickString('', userEnv.R7_DISK_BASE_URL).replace(/\/+$/, '');
}

function pickString(primary, fallback) {
	if (typeof primary === 'string' && primary.trim()) return primary.trim();
	if (typeof fallback === 'string' && fallback.trim()) return fallback.trim();
	return '';
}

function resolveSkillStorage(state) {
	const caps = state.capabilities;
	if (!caps || typeof caps !== 'object') return null;
	const raw = caps.skillStorage ?? caps.storage ?? caps['key-value-storage'];
	if (!raw || typeof raw !== 'object') return null;
	if (typeof raw.get !== 'function' || typeof raw.set !== 'function') return null;
	return raw;
}

function errorMessage(value) {
	return value instanceof Error ? value.message : String(value);
}

function truncate(text, max) {
	const value = String(text || '');
	return value.length <= max ? value : `${value.slice(0, max)}...`;
}

async function readUtf8Text(response) {
	return response.text();
}
