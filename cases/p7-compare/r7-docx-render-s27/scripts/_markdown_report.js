/**
 * Markdown compare report → CompareReport (doc-compare/v1) for DOCX render.
 */

function parseMarkdownCompareReport(markdown) {
	const text = String(markdown || '').trim();
	if (!text) {
		return { ok: false, error: 'Пустой markdown-отчёт.' };
	}

	const lines = text.split(/\r?\n/);
	let title = 'Результаты сравнения';
	const metaLines = [];
	const quotes = [];
	const tables = [];

	let i = 0;
	while (i < lines.length) {
		const line = lines[i];
		const heading = line.match(/^#{1,3}\s+(.+)$/);
		if (heading) {
			const h = heading[1].trim();
			if (/результат/i.test(h) || /сравнен/i.test(h)) {
				title = h;
			}
			i += 1;
			continue;
		}

		const templateMeta = line.match(/^\*{0,2}Шаблон\*{0,2}\s*[:：]\s*(.+)$/i);
		if (templateMeta) {
			metaLines.push('Шаблон: ' + stripInlineMd(templateMeta[1]));
			i += 1;
			continue;
		}
		const docMeta = line.match(/^\*{0,2}Документ\*{0,2}\s*[:：]\s*(.+)$/i);
		if (docMeta) {
			metaLines.push('Документ: ' + stripInlineMd(docMeta[1]));
			i += 1;
			continue;
		}
		const diffsMeta = line.match(/^\*?\*?Расхождени[яй]\*?\*?\s*[:：]\s*(\d+)/i);
		if (diffsMeta) {
			metaLines.push('Расхождений: ' + diffsMeta[1]);
			i += 1;
			continue;
		}

		if (/^\s*\|.+\|\s*$/.test(line) && i + 1 < lines.length && /^\s*\|[-:\s|]+\|\s*$/.test(lines[i + 1])) {
			const table = parseMarkdownTableBlock(lines, i);
			if (table) {
				tables.push(table);
				i = table.endIndex;
				continue;
			}
		}

		if (/^резюме\s*[:：]?\s*$/i.test(line.trim()) || /^#{1,4}\s*резюме/i.test(line)) {
			i += 1;
			while (i < lines.length) {
				const bullet = lines[i].match(/^\s*[-*•]\s+(.+)$/);
				if (!bullet) break;
				quotes.push(stripInlineMd(bullet[1].trim()));
				i += 1;
			}
			continue;
		}

		const numbered = line.match(/^\s*\d+[.)]\s+(.+)$/);
		if (numbered && quotes.length > 0) {
			quotes.push(stripInlineMd(numbered[1].trim()));
			i += 1;
			continue;
		}

		i += 1;
	}

	if (tables.length === 0) {
		return { ok: false, error: 'В markdown нет таблицы сравнения (строки | ... |).' };
	}

	const sections = [
		{
			heading: '',
			level: 2,
			tables: tables.map(function (t) {
				return { headers: t.headers, rows: t.rows };
			}),
			quotes: []
		}
	];

	if (quotes.length > 0) {
		sections.push({
			heading: 'Резюме',
			level: 2,
			tables: [],
			quotes: quotes
		});
	}

	const totalDiffs = extractTotalDiffs(text, tables[0]);

	return {
		ok: true,
		report: {
			schema: 'doc-compare/v1',
			title: title,
			suggestedFileName: defaultCompareFileName(),
			meta: {
				totalDiffs: totalDiffs
			},
			metaLines: metaLines,
			sections: sections
		}
	};
}

function parseMarkdownTableBlock(lines, start) {
	if (!/^\s*\|.+\|\s*$/.test(lines[start])) return null;
	if (start + 1 >= lines.length || !/^\s*\|[-:\s|]+\|\s*$/.test(lines[start + 1])) return null;

	const headers = splitTableRow(lines[start]);
	const rows = [];
	let i = start + 2;
	while (i < lines.length && /^\s*\|.+\|\s*$/.test(lines[i])) {
		rows.push(splitTableRow(lines[i]));
		i += 1;
	}
	if (headers.length === 0 && rows.length === 0) return null;
	return { headers: headers, rows: rows, endIndex: i };
}

function splitTableRow(line) {
	return line
		.trim()
		.replace(/^\|/, '')
		.replace(/\|$/, '')
		.split('|')
		.map(function (cell) {
			return stripInlineMd(cell.trim());
		});
}

function stripInlineMd(text) {
	return String(text || '')
		.replace(/\*\*(.+?)\*\*/g, '$1')
		.replace(/`([^`]+)`/g, '$1')
		.trim();
}

function extractTotalDiffs(text, primaryTable) {
	const m = text.match(/Расхождени[яй]\s*[:：]\s*(\d+)/i);
	if (m) return parseInt(m[1], 10);
	if (!primaryTable || !primaryTable.rows) return undefined;
	let n = 0;
	for (let i = 0; i < primaryTable.rows.length; i++) {
		const row = primaryTable.rows[i];
		const mark = row[row.length - 1] || '';
		if (/отлича|diff|⚠/i.test(mark)) n += 1;
	}
	return n > 0 ? n : primaryTable.rows.length;
}

function defaultCompareFileName() {
	const d = new Date();
	const pad = function (n) {
		return String(n).padStart(2, '0');
	};
	const stamp =
		d.getUTCFullYear() +
		'-' +
		pad(d.getUTCMonth() + 1) +
		'-' +
		pad(d.getUTCDate()) +
		'_' +
		pad(d.getUTCHours()) +
		'-' +
		pad(d.getUTCMinutes());
	return 'compare-report-' + stamp + '.docx';
}
