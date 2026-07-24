/**
 * Атомарный export: CompareReport → DOCX в памяти → session VFS → r7.task deliver_file.
 */
async function handler(state, params) {
	const raw = params && typeof params === 'object' ? params : {};
	let toolParams = raw;

	const reportPath =
		typeof raw.reportPath === 'string' && raw.reportPath.trim()
			? raw.reportPath.trim()
			: typeof raw.report_path === 'string' && raw.report_path.trim()
				? raw.report_path.trim()
				: '';

	if (reportPath && !raw.report) {
		const loaded = await loadReportFromVfsPath(state, reportPath);
		if (!loaded.ok) {
			return { ok: false, error: loaded.error };
		}
		toolParams = Object.assign({}, raw, { report: loaded.report });
	}

	const report = normalizeReport(toolParams);
	if (!report.ok) {
		return { ok: false, error: /** @type {{ ok: false, error: string }} */ (report).error };
	}
	const reportData = report.data;

	const fileName = sanitizeFileName(reportData.fileName);
	const mimeType = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
	const docxBytes = buildCompareDocxBytes(reportData);

	const upload = await uploadDocxToSessionVfs(state, {
		fileName,
		mimeType,
		bytes: docxBytes
	});
	if (!upload.ok) {
		return { ok: false, error: /** @type {{ ok: false, error: string }} */ (upload).error };
	}

	const actions = normalizeActions(
		params && typeof params === 'object'
			? /** @type {Record<string, unknown>} */ (params).actions
			: undefined
	);
	const r7Task = buildDeliverFileTask({
		fileId: upload.fileId,
		fileName,
		mimeType,
		actions
	});
	const r7TaskBlock = formatR7TaskBlock(r7Task);

	const sectionCount = reportData.sections.length;
	const tableCount = reportData.sections.reduce((n, s) => n + (s.tables?.length ?? 0), 0);

	return {
		ok: true,
		fileId: upload.fileId,
		fileName,
		mimeType,
		bytes: docxBytes.length,
		sections: sectionCount,
		tables: tableCount,
		r7_task: r7Task,
		r7_task_block: r7TaskBlock,
		agent_message:
			`Отчёт Word готов: ${fileName} (fileId=${upload.fileId}). ` +
			'Включи в ответ пользователю блок r7_task_block без изменений.'
	};
}

async function loadReportFromVfsPath(state, vfsPath) {
	const vfs = getSessionVfsForRead(state);
	if (!vfs) {
		return { ok: false, error: 'VFS readFile (session) недоступен для reportPath' };
	}
	const readFn = vfs.readFile || vfs.read;
	if (typeof readFn !== 'function') {
		return { ok: false, error: 'VFS readFile недоступен' };
	}
	let raw;
	try {
		raw = await readFn.call(vfs, vfsPath);
	} catch (err) {
		return { ok: false, error: 'Не удалось прочитать ' + vfsPath + ': ' + (err && err.message ? err.message : String(err)) };
	}
	const text = typeof raw === 'string' ? raw : raw && raw.content ? String(raw.content) : String(raw || '');
	if (!text.trim()) {
		return { ok: false, error: 'Пустой файл отчёта: ' + vfsPath };
	}
	try {
		const report = JSON.parse(text);
		if (!report || typeof report !== 'object') {
			return { ok: false, error: 'Невалидный JSON в ' + vfsPath };
		}
		return { ok: true, report: report };
	} catch {
		return { ok: false, error: 'JSON.parse failed для ' + vfsPath };
	}
}

function getSessionVfsForRead(state) {
	const caps =
		state && state.capabilities && typeof state.capabilities === 'object'
			? state.capabilities
			: {};
	if (caps.vfs && (typeof caps.vfs.readFile === 'function' || typeof caps.vfs.read === 'function')) {
		return caps.vfs;
	}
	for (const key of ['vfs-session', 'sessionVfs', 'session_vfs', 'agentVfs']) {
		const adapter = caps[key];
		if (adapter && (typeof adapter.readFile === 'function' || typeof adapter.read === 'function')) {
			return adapter;
		}
	}
	return null;
}
