/* R7 Disk minimal client for analytics_csv (auth, download, upload). */

function readUserEnv(state) {
	const env = state && typeof state === 'object' ? state.environment : null;
	if (!env || typeof env !== 'object') return {};
	const user = env.user;
	if (!user || typeof user !== 'object') return {};
	return user;
}

function resolveSkillStorage(state) {
	const caps = state && typeof state === 'object' ? state.capabilities : null;
	if (!caps || typeof caps !== 'object') return null;
	const raw = caps.skillStorage ?? caps.storage ?? caps['key-value-storage'];
	if (!raw || typeof raw !== 'object') return null;
	if (typeof raw.get !== 'function' || typeof raw.set !== 'function') return null;
	return raw;
}

function pickString(primary, fallback) {
	if (typeof primary === 'string' && primary.trim()) return primary.trim();
	if (typeof fallback === 'string' && fallback.trim()) return fallback.trim();
	return '';
}

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

function resolvePositiveId(value) {
	if (typeof value === 'number' && Number.isFinite(value) && value > 0) return Math.trunc(value);
	if (typeof value === 'string' && value.trim()) {
		const parsed = Number(value.trim());
		if (Number.isFinite(parsed) && parsed > 0) return Math.trunc(parsed);
	}
	return null;
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
		return {
			ok: false,
			error: 'Нет auth_token и не заданы R7_DISK_LOGIN/R7_DISK_PASSWORD для авто-login.'
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
	if (!response.ok) return { ok: false, error: `Login HTTP ${response.status}: ${truncate(rawText, 240)}` };
	const authToken = payload?.Response?.Data?.Tokens?.AuthToken;
	if (typeof authToken !== 'string' || !authToken) return { ok: false, error: 'Login: AuthToken не найден.' };
	if (skillStorage) {
		skillStorage.set('r7_disk_auth_token', authToken);
		skillStorage.set('r7_disk_base_url', baseUrl);
	}
	return { ok: true, auth_token: authToken };
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

async function apiRequest(method, url, authToken, body) {
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

function encodeUtf8(text) {
	return new TextEncoder().encode(text);
}

function toFetchBinaryBody(bytes) {
	return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
}

function escapeHeaderFileName(name) {
	return String(name || 'file.xlsx').replace(/[\r\n"]/g, '_');
}

function toAsciiFallbackFilename(fileName) {
	const dot = fileName.lastIndexOf('.');
	const ext = dot > 0 ? fileName.slice(dot) : '';
	const base = (dot > 0 ? fileName.slice(0, dot) : fileName).replace(/[^\x20-\x7E]/g, '_');
	const safeBase = (base.replace(/_+/g, '_').replace(/^_|_$/g, '') || 'file').slice(0, 80);
	const safeExt = ext.replace(/[^\x20-\x7E.]/g, '');
	return safeBase + safeExt;
}

function concatBytes(chunks) {
	const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
	const out = new Uint8Array(total);
	let offset = 0;
	for (const chunk of chunks) {
		out.set(chunk, offset);
		offset += chunk.length;
	}
	return out;
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

async function performMultipartUpload(baseUrl, authToken, directoryId, fileName, fileBytes, mimeOverride) {
	const url = `${baseUrl}/api/v1/Documents/Upload`;
	const boundary = `----R7Disk${Date.now()}`;
	const contentType =
		mimeOverride || 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
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

function stampOutputName(name) {
	const dot = name.lastIndexOf('.');
	const base = dot > 0 ? name.slice(0, dot) : name;
	const ext = dot > 0 ? name.slice(dot) : '.xlsx';
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

function sanitizeFileName(name) {
	return String(name || '')
		.trim()
		.replace(/[<>:"|?*\u0000-\u001f]/g, '_')
		.replace(/\s+/g, ' ')
		.slice(0, 120);
}

function buildDefaultOutputName() {
	const now = new Date();
	const stamp =
		String(now.getFullYear()) +
		String(now.getMonth() + 1).padStart(2, '0') +
		String(now.getDate()).padStart(2, '0') +
		'_' +
		String(now.getHours()).padStart(2, '0') +
		String(now.getMinutes()).padStart(2, '0');
	return `sales_report_${stamp}.xlsx`;
}

function ensureXlsxExtension(name) {
	const trimmed = String(name || '').trim();
	return /\.xlsx$/i.test(trimmed) ? trimmed : `${trimmed}.xlsx`;
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
		return { ok: false, error: `Файл «${name}» уже существует в папке id=${directoryId}.` };
	}
	return { ok: true, name: stampOutputName(name) };
}

function decodeUtf8(bytes) {
	return new TextDecoder('utf-8').decode(bytes);
}
