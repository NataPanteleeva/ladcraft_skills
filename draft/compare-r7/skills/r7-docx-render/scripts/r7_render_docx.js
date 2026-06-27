/**
 * Сборка DOCX из CompareReport JSON — только stdlib (ZIP + OOXML), без python-docx/pandoc.
 */
async function handler(state, params) {
	const report = normalizeReport(params);
	if (!report.ok) {
		return { ok: false, error: /** @type {{ ok: false, error: string }} */ (report).error };
	}
	const reportData = report.data;

	const fileName = sanitizeFileName(reportData.fileName);
	const outPath = `/workspace/out/${fileName}`;
	const docxBytes = buildCompareDocxBytes(reportData);

	const saved = await writeBinaryToVfs(state, outPath, docxBytes);
	if (!saved.ok) {
		return { ok: false, error: saved.error };
	}

	const sectionCount = reportData.sections.length;
	const tableCount = reportData.sections.reduce((n, s) => n + (s.tables?.length ?? 0), 0);

	return {
		ok: true,
		localPath: outPath,
		fileName,
		mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
		sections: sectionCount,
		tables: tableCount,
		bytes: docxBytes.length,
		agent_message:
			`DOCX собран: ${fileName} (${sectionCount} раздел(ов), ${tableCount} таблиц). ` +
			'Для compare-r7 используй r7_render_and_deliver_docx вместо отдельного deliver.'
	};
}
