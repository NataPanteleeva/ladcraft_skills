/**
 * Загружает DOCX в session VFS и возвращает готовый блок r7.task (deliver_file).
 */
async function handler(state, params) {
	const normalized = normalizeInput(params);
	if (!normalized.ok) {
		return { ok: false, error: /** @type {{ ok: false, error: string }} */ (normalized).error };
	}
	const input = normalized.data;

	const bytesResult = await resolveDocxBytes(state, input);
	if (!bytesResult.ok) {
		return { ok: false, error: /** @type {{ ok: false, error: string }} */ (bytesResult).error };
	}
	const bytes = bytesResult.data;

	const upload = await uploadDocxToSessionVfs(state, {
		fileName: input.fileName,
		mimeType: input.mimeType,
		bytes
	});
	if (!upload.ok) {
		return { ok: false, error: /** @type {{ ok: false, error: string }} */ (upload).error };
	}

	const r7Task = buildDeliverFileTask({
		fileId: upload.fileId,
		fileName: input.fileName,
		mimeType: input.mimeType,
		actions: input.actions
	});
	const r7TaskBlock = formatR7TaskBlock(r7Task);

	return {
		ok: true,
		fileId: upload.fileId,
		fileName: input.fileName,
		mimeType: input.mimeType,
		bytes: bytes.length,
		r7_task: r7Task,
		r7_task_block: r7TaskBlock,
		agent_message:
			`DOCX загружен в VFS: ${input.fileName} (fileId=${upload.fileId}). ` +
			'Включи в ответ пользователю блок r7.task из поля r7_task_block без изменений.'
	};
}

/**
 * @param {unknown} params
 * @returns {{ ok: true, data: NormalizedInput } | { ok: false, error: string }}
 */
function normalizeInput(params) {
	const raw = params && typeof params === 'object' ? /** @type {Record<string, unknown>} */ (params) : {};

	const render =
		raw.render && typeof raw.render === 'object'
			? /** @type {Record<string, unknown>} */ (raw.render)
			: null;

	const renderLocalPath =
		render && typeof render.localPath === 'string' ? render.localPath.trim() : '';
	const fileName = sanitizeFileName(
		pickString(raw.fileName, render?.fileName, renderLocalPath ? renderLocalPath.split('/').pop() : '')
	);
	const mimeType =
		pickString(raw.mimeType, render?.mimeType) ||
		'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
	const content_base64 = pickString(raw.content_base64, render?.content_base64);
	const localPath = pickString(raw.localPath, render?.localPath);
	const actions = normalizeActions(raw.actions);

	if (!content_base64 && !localPath) {
		return {
			ok: false,
			error: 'Нужен content_base64 или localPath (из ответа r7_render_docx).'
		};
	}

	return {
		ok: true,
		data: {
			fileName,
			mimeType,
			content_base64,
			localPath,
			actions
		}
	};
}

/**
 * @typedef {Object} NormalizedInput
 * @property {string} fileName
 * @property {string} mimeType
 * @property {string} content_base64
 * @property {string} localPath
 * @property {string[]} actions
 */

/**
 * @param {Record<string, unknown>} state
 * @param {NormalizedInput} input
 * @returns {Promise<{ ok: true, data: Uint8Array } | { ok: false, error: string }>}
 */
async function resolveDocxBytes(state, input) {
	if (input.content_base64) {
		const bytes = decodeBase64(input.content_base64);
		if (!bytes || bytes.length === 0) {
			return { ok: false, error: 'Некорректный или пустой content_base64.' };
		}
		return { ok: true, data: bytes };
	}

	return readBytesFromVfs(state, input.localPath);
}

/**
 * @param {Record<string, unknown>} state
 * @param {string} vfsPath
 * @returns {Promise<{ ok: true, data: Uint8Array } | { ok: false, error: string }>}
 */
async function readBytesFromVfs(state, vfsPath) {
	const vfs = getVfsAdapter(state);
	if (!vfs) {
		return { ok: false, error: 'VFS недоступен для чтения localPath.' };
	}
	const readFn = vfs.readFile ?? vfs.read;
	if (typeof readFn !== 'function') {
		return { ok: false, error: 'VFS: нет readFile/read.' };
	}
	try {
		const raw = await readFn(vfsPath);
		const bytes = toByteArray(raw);
		if (!bytes || bytes.length === 0) {
			return {
				ok: false,
				error: `Файл пуст или не найден в skill VFS: ${vfsPath}. Передай content_base64 из r7_render_docx.`
			};
		}
		return { ok: true, data: bytes };
	} catch (err) {
		return { ok: false, error: `Не удалось прочитать ${vfsPath}: ${errorMessage(err)}` };
	}
}

/**
 * @param {Record<string, unknown>} state
 * @param {{ fileName: string, mimeType: string, bytes: Uint8Array }} payload
 * @returns {Promise<{ ok: true, fileId: string } | { ok: false, error: string }>}
 */
async function uploadDocxToSessionVfs(state, payload) {
	const caps =
		state.capabilities && typeof state.capabilities === 'object'
			? /** @type {Record<string, unknown>} */ (state.capabilities)
			: {};

	const vfs = getVfsAdapter(state);
	if (vfs) {
		const uploadFn = pickFunction(vfs, ['upload', 'uploadFile', 'Upload']);
		if (uploadFn) {
			const fileId = await tryUploadVariants(uploadFn, vfs, payload);
			if (fileId) return { ok: true, fileId };
		}
	}

	for (const key of ['vfs-session', 'sessionVfs', 'agentVfs', 'session_vfs']) {
		const adapter = caps[key];
		if (!adapter || typeof adapter !== 'object') continue;
		const uploadFn = pickFunction(/** @type {Record<string, unknown>} */ (adapter), [
			'upload',
			'uploadFile',
			'Upload'
		]);
		if (!uploadFn) continue;
		const fileId = await tryUploadVariants(
			uploadFn,
			/** @type {Record<string, unknown>} */ (adapter),
			payload
		);
		if (fileId) return { ok: true, fileId };
	}

	for (const [capKey, adapter] of Object.entries(caps)) {
		if (capKey === 'vfs' || !adapter || typeof adapter !== 'object') continue;
		const uploadFn = pickFunction(/** @type {Record<string, unknown>} */ (adapter), [
			'upload',
			'uploadFile',
			'Upload'
		]);
		if (!uploadFn) continue;
		const fileId = await tryUploadVariants(
			uploadFn,
			/** @type {Record<string, unknown>} */ (adapter),
			payload
		);
		if (fileId) return { ok: true, fileId };
	}

	return {
		ok: false,
		error:
			'VFS upload (scope=session) недоступен в runtime. ' +
			'Обновите r7-export на Ladcraft и проверьте capability vfs/upload для session scope.'
	};
}

/**
 * @param {Function} uploadFn
 * @param {unknown} ctx
 * @param {{ fileName: string, mimeType: string, bytes: Uint8Array }} payload
 * @returns {Promise<string | null>}
 */
async function tryUploadVariants(uploadFn, ctx, payload) {
	const base64 = toBase64(payload.bytes);
	/** @type {Record<string, unknown>[]} */
	const variants = [
		{
			scope: 'session',
			fileName: payload.fileName,
			file_name: payload.fileName,
			content: payload.bytes,
			data: payload.bytes,
			mimeType: payload.mimeType,
			mime_type: payload.mimeType
		},
		{
			scope: 'session',
			fileName: payload.fileName,
			file_name: payload.fileName,
			content_base64: base64,
			encoding: 'base64',
			mimeType: payload.mimeType,
			mime_type: payload.mimeType
		},
		{
			fileName: payload.fileName,
			content: payload.bytes,
			mimeType: payload.mimeType
		}
	];

	for (const variant of variants) {
		try {
			const result = await uploadFn.call(ctx, variant);
			const fileId = extractFileId(result);
			if (fileId) return fileId;
		} catch {
			/* try next variant */
		}
	}
	return null;
}

/**
 * @param {unknown} result
 * @returns {string | null}
 */
function extractFileId(result) {
	if (typeof result === 'string' && isUuid(result)) return result;
	if (!result || typeof result !== 'object') return null;

	const record = /** @type {Record<string, unknown>} */ (result);
	const direct = [record.file_id, record.fileId, record.id, record.uuid];
	for (const value of direct) {
		if (typeof value === 'string' && isUuid(value)) return value;
	}

	const nested = [record.data, record.file, record.result];
	for (const node of nested) {
		if (!node || typeof node !== 'object') continue;
		const inner = /** @type {Record<string, unknown>} */ (node);
		for (const value of [inner.file_id, inner.fileId, inner.id, inner.uuid]) {
			if (typeof value === 'string' && isUuid(value)) return value;
		}
	}
	return null;
}

/**
 * @param {{ fileId: string, fileName: string, mimeType: string, actions: string[] }} input
 * @returns {Array<{ type: string, data: Record<string, unknown> }>}
 */
function buildDeliverFileTask(input) {
	return [
		{
			type: 'deliver_file',
			data: {
				fileId: input.fileId,
				fileName: input.fileName,
				mimeType: input.mimeType,
				actions: input.actions,
				importAs: null
			}
		}
	];
}

/**
 * @param {Array<{ type: string, data: Record<string, unknown> }>} tasks
 * @returns {string}
 */
function formatR7TaskBlock(tasks) {
	return '```r7.task\n' + JSON.stringify(tasks, null, 2) + '\n```';
}

/**
 * @param {Record<string, unknown>} state
 * @returns {Record<string, unknown> | null}
 */
function getVfsAdapter(state) {
	const caps =
		state.capabilities && typeof state.capabilities === 'object'
			? /** @type {Record<string, unknown>} */ (state.capabilities)
			: {};
	const raw = caps.vfs;
	return raw && typeof raw === 'object' ? /** @type {Record<string, unknown>} */ (raw) : null;
}

/**
 * @param {Record<string, unknown>} obj
 * @param {string[]} names
 * @returns {Function | null}
 */
function pickFunction(obj, names) {
	for (const name of names) {
		const fn = obj[name];
		if (typeof fn === 'function') return fn;
	}
	return null;
}

/**
 * @param {unknown} value
 * @returns {string[]}
 */
function normalizeActions(value) {
	if (!Array.isArray(value)) return ['download'];
	const actions = value.map(String).map((s) => s.trim()).filter(Boolean);
	return actions.length > 0 ? actions : ['download'];
}

/**
 * @param {string} name
 * @returns {string}
 */
function sanitizeFileName(name) {
	const base = String(name || '').trim() || 'сравнение.docx';
	return base.toLowerCase().endsWith('.docx') ? base : `${base}.docx`;
}

/**
 * @param {...unknown} values
 * @returns {string}
 */
function pickString() {
	const values = Array.from(arguments);
	for (const value of values) {
		if (typeof value === 'string' && value.trim()) return value.trim();
	}
	return '';
}

/**
 * @param {string} encoded
 * @returns {Uint8Array | null}
 */
function decodeBase64(encoded) {
	try {
		if (typeof Buffer !== 'undefined') {
			return new Uint8Array(Buffer.from(encoded, 'base64'));
		}
		const binary = atob(encoded);
		const out = new Uint8Array(binary.length);
		for (let i = 0; i < binary.length; i += 1) {
			out[i] = binary.charCodeAt(i);
		}
		return out;
	} catch {
		return null;
	}
}

/**
 * @param {Uint8Array} bytes
 * @returns {string}
 */
function toBase64(bytes) {
	if (typeof Buffer !== 'undefined') {
		return Buffer.from(bytes).toString('base64');
	}
	let binary = '';
	for (let i = 0; i < bytes.length; i += 1) {
		binary += String.fromCharCode(bytes[i]);
	}
	return btoa(binary);
}

/**
 * @param {unknown} raw
 * @returns {Uint8Array | null}
 */
function toByteArray(raw) {
	if (raw == null) return null;
	if (raw instanceof Uint8Array) return raw;
	if (typeof Buffer !== 'undefined' && Buffer.isBuffer(raw)) {
		return new Uint8Array(raw);
	}
	if (typeof raw === 'string') {
		if (!raw.length) return new Uint8Array(0);
		return decodeBase64(raw) ?? new TextEncoder().encode(raw);
	}
	return null;
}

/**
 * @param {string} value
 * @returns {boolean}
 */
function isUuid(value) {
	return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

/**
 * @param {unknown} value
 * @returns {string}
 */
function errorMessage(value) {
	return value instanceof Error ? value.message : String(value);
}