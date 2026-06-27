/**
 * Атомарный export: CompareReport → DOCX в памяти → session VFS → r7.task deliver_file.
 */
async function handler(state, params) {
	const report = normalizeReport(params);
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
