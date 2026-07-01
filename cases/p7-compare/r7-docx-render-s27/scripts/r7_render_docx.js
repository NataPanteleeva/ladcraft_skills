/**
 * Сборка DOCX из CompareReport или markdown-отчёта — stdlib ZIP+OOXML.
 */
async function handler(state, params) {
	const report = normalizeReport(resolveRenderParams(params));
	if (!report.ok) {
		return { ok: false, error: report.error };
	}
	const reportData = report.data;

	const fileName = sanitizeFileName(reportData.fileName);
	const outPath = '/workspace/out/' + fileName;
	const docxBytes = buildCompareDocxBytes(reportData);

	const saved = await writeBinaryToVfs(state, outPath, docxBytes);
	if (!saved.ok) {
		return { ok: false, error: saved.error };
	}

	const sectionCount = reportData.sections.length;
	let tableCount = 0;
	for (let i = 0; i < reportData.sections.length; i += 1) {
		tableCount += reportData.sections[i].tables ? reportData.sections[i].tables.length : 0;
	}
	const content_base64 = toBase64(docxBytes);

	return {
		ok: true,
		localPath: outPath,
		fileName: fileName,
		mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
		content_base64: content_base64,
		sections: sectionCount,
		tables: tableCount,
		bytes: docxBytes.length,
		agent_message:
			'DOCX собран: ' +
			fileName +
			' (' +
			sectionCount +
			' раздел(ов), ' +
			tableCount +
			' таблиц). Вызови r7_save_compare_report_to_disk с content_base64, fileName и markdown отчёта.'
	};
}

function resolveRenderParams(params) {
	const raw = params && typeof params === 'object' ? params : {};
	const markdown =
		typeof raw.markdown === 'string' && raw.markdown.trim() ? raw.markdown.trim() : '';
	if (markdown && !raw.report) {
		const parsed = parseMarkdownCompareReport(markdown);
		if (!parsed.ok) {
			return { __parseError: parsed.error };
		}
		return { report: parsed.report };
	}
	return raw;
}
