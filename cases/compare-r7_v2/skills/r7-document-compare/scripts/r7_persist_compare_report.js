/**
 * Persist slim CompareReport to session VFS for EXPORT (survives context compaction).
 */
async function handler(state, params) {
	const raw = params && typeof params === 'object' ? params : {};
	let report = raw.report;
	if (typeof report === 'string' && report.trim()) {
		try {
			report = JSON.parse(report);
		} catch {
			return { ok: false, error: 'report должен быть объектом CompareReport или JSON-строкой' };
		}
	}
	if (!report || typeof report !== 'object' || Array.isArray(report)) {
		return { ok: false, error: 'report обязателен (объект CompareReport doc-compare/v1)' };
	}

	const slim = Object.assign({}, report);
	delete slim.chatMarkdown;
	delete slim.chat_markdown;

	const vfsPath =
		typeof raw.path === 'string' && raw.path.trim()
			? raw.path.trim()
			: '/session/compare/latest.json';

	const payload = JSON.stringify(slim);
	const caps = state && state.capabilities && typeof state.capabilities === 'object' ? state.capabilities : {};
	const vfs = caps.vfs && typeof caps.vfs === 'object' ? caps.vfs : null;

	if (!vfs) {
		return { ok: false, error: 'VFS недоступен (state.capabilities.vfs)' };
	}

	const uploadFn =
		typeof vfs.upload === 'function'
			? vfs.upload.bind(vfs)
			: typeof vfs.uploadFile === 'function'
				? vfs.uploadFile.bind(vfs)
				: null;

	if (uploadFn) {
		try {
			await withTimeout(
				uploadFn({
					scope: 'session',
					path: vfsPath,
					content: payload,
					mimeType: 'application/json',
					mime_type: 'application/json',
					fileName: 'latest.json',
					file_name: 'latest.json'
				}),
				8000
			);
			return { ok: true, path: vfsPath, bytes: payload.length, schema: slim.schema || 'doc-compare/v1', method: 'upload' };
		} catch {
			/* fall through to writeFile */
		}
	}

	if (typeof vfs.writeFile !== 'function') {
		return { ok: false, error: 'VFS writeFile/upload недоступен' };
	}

	try {
		await withTimeout(vfs.writeFile(vfsPath, payload), 8000);
		return { ok: true, path: vfsPath, bytes: payload.length, schema: slim.schema || 'doc-compare/v1', method: 'writeFile' };
	} catch (err) {
		try {
			await withTimeout(vfs.writeFile(vfsPath, payload, { scope: 'session' }), 8000);
			return { ok: true, path: vfsPath, bytes: payload.length, schema: slim.schema || 'doc-compare/v1', method: 'writeFile+scope' };
		} catch (err2) {
			return {
				ok: false,
				error: 'persist failed: ' + (err2 && err2.message ? err2.message : String(err2 || err))
			};
		}
	}
}

function withTimeout(promise, ms) {
	return new Promise(function (resolve, reject) {
		const timer = setTimeout(function () {
			reject(new Error('timeout ' + ms + 'ms'));
		}, ms);
		Promise.resolve(promise).then(
			function (value) {
				clearTimeout(timer);
				resolve(value);
			},
			function (err) {
				clearTimeout(timer);
				reject(err);
			}
		);
	});
}
