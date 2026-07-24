
function normalizeReport(params) {
	const raw = params && typeof params === 'object' ? params : {};
	if (typeof raw.__parseError === 'string') {
		return { ok: false, error: raw.__parseError };
	}
	const report =
		raw.report && typeof raw.report === 'object' ? raw.report : raw;

	const title = pickString(report.title) || 'Сравнение документов';
	const fileName =
		pickString(report.suggestedFileName, report.outputFileName) || 'сравнение.docx';
	const sections = normalizeSections(report.sections);
	const meta = report.meta && typeof report.meta === 'object' ? report.meta : null;

	var metaLines = [];
	if (Array.isArray(report.metaLines)) {
		metaLines = report.metaLines.map(String).filter(Boolean);
	}
	if (meta) {
		const docA = meta.documentA;
		const docB = meta.documentB;
		if (docA && typeof docA === 'object') {
			const name = pickString(docA.name);
			if (name) metaLines.push('Эталон: ' + name);
		}
		if (docB && typeof docB === 'object') {
			const name = pickString(docB.name);
			if (name) metaLines.push('Документ: ' + name);
		}
		if (typeof meta.totalDiffs === 'number' && metaLines.every(function (l) {
			return !/^Расхождени/i.test(l);
		})) {
			metaLines.push('Расхождений: ' + meta.totalDiffs);
		}
	}

	const summaryTable = normalizeTable(report.summaryTable);
	if (summaryTable) {
		sections.push({
			heading: 'Сводка',
			level: 2,
			tables: [summaryTable],
			quotes: []
		});
	}

	const risks = Array.isArray(report.risks) ? report.risks.map(String).filter(Boolean) : [];
	if (risks.length > 0) {
		sections.push({
			heading: 'Риски',
			level: 2,
			tables: [],
			quotes: risks
		});
	}

	if (sections.length === 0) {
		return { ok: false, error: 'Нет sections/tables для DOCX. Передай CompareReport из doc-compare.' };
	}

	return {
		ok: true,
		data: {
			title,
			fileName,
			metaLines,
			sections
		}
	};
}

/**
 * @param {unknown} sectionsRaw
 * @returns {ReportSection[]}
 */
function normalizeSections(sectionsRaw) {
	if (!Array.isArray(sectionsRaw)) return [];
	/** @type {ReportSection[]} */
	const out = [];
	for (const item of sectionsRaw) {
		if (!item || typeof item !== 'object') continue;
		const s = /** @type {Record<string, unknown>} */ (item);
		const heading = pickString(s.heading);
		const level = typeof s.level === 'number' ? Math.min(3, Math.max(1, s.level)) : 2;
		/** @type {ReportTable[]} */
		const tables = [];
		if (Array.isArray(s.tables)) {
			for (const t of s.tables) {
				const table = normalizeTable(t);
				if (table) tables.push(table);
			}
		}
		const quotes = Array.isArray(s.quotes) ? s.quotes.map(String).filter(Boolean) : [];
		if (heading || tables.length > 0 || quotes.length > 0) {
			out.push({ heading: heading || '', level, tables, quotes });
		}
	}
	return out;
}

/**
 * @param {unknown} raw
 * @returns {ReportTable | null}
 */
function normalizeTable(raw) {
	if (!raw || typeof raw !== 'object') return null;
	const t = /** @type {Record<string, unknown>} */ (raw);
	const headers = Array.isArray(t.headers) ? t.headers.map(String) : [];
	const rows = Array.isArray(t.rows)
		? t.rows.map((row) => (Array.isArray(row) ? row.map(String) : []))
		: [];
	if (headers.length === 0 && rows.length === 0) return null;
	return { headers, rows };
}

/**
 * @param {NormalizedReport} report
 * @returns {Uint8Array}
 */
function buildCompareDocxBytes(report) {
	/** @type {string[]} */
	const bodyParts = [];
	bodyParts.push(buildHeadingXml(report.title, 1));
	for (const line of report.metaLines) {
		bodyParts.push(buildParagraphXml(line));
	}
	if (report.metaLines.length > 0) {
		bodyParts.push(buildParagraphXml(''));
	}

	for (const section of report.sections) {
		if (section.heading) {
			bodyParts.push(buildHeadingXml(section.heading, section.level));
		}
		for (const table of section.tables) {
			bodyParts.push(buildTableXml(table.headers, table.rows));
			bodyParts.push(buildParagraphXml(''));
		}
		for (const quote of section.quotes) {
			bodyParts.push(buildParagraphXml(quote, { italic: true }));
		}
	}

	const documentXml = buildDocumentXml(bodyParts.join(''));
	return buildDocxArchive(documentXml);
}

/**
 * @param {string} innerBodyXml
 * @returns {string}
 */
function buildDocumentXml(innerBodyXml) {
	const nsWord = pkgSchemaUri('/wordprocessingml/2006/main');
	return (
		'<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
		`<w:document xmlns:w="${nsWord}">` +
		`<w:body>${innerBodyXml}<w:sectPr/></w:body></w:document>`
	);
}

var TABLE_CELL_MARGIN_DXA = 120;
var COMPARE_TABLE_COL_WIDTHS = [1200, 2200, 2200, 3400, 1000];

/**
 * @param {string} text
 * @param {number} level
 * @returns {string}
 */
function buildHeadingXml(text, level) {
	const style = level === 1 ? 'Heading1' : level === 2 ? 'Heading2' : 'Heading3';
	const center = level === 1 ? '<w:jc w:val="center"/>' : '';
	return (
		`<w:p><w:pPr><w:pStyle w:val="${style}"/>` +
		center +
		`</w:pPr>` +
		`<w:r><w:rPr><w:b/></w:rPr><w:t xml:space="preserve">${escapeXml(text)}</w:t></w:r></w:p>`
	);
}

/**
 * @param {string} text
 * @param {{ italic?: boolean, bold?: boolean }} [opts]
 * @returns {string}
 */
function buildParagraphXml(text, opts) {
	let rPr = '';
	if (opts?.bold) rPr += '<w:b/>';
	if (opts?.italic) rPr += '<w:i/>';
	const rPrBlock = rPr ? `<w:rPr>${rPr}</w:rPr>` : '';
	return `<w:p><w:r>${rPrBlock}<w:t xml:space="preserve">${escapeXml(text)}</w:t></w:r></w:p>`;
}

function findMarkColumnIndex(headers) {
	for (let i = 0; i < headers.length; i++) {
		if (/^метка$/i.test(String(headers[i] || '').trim())) {
			return i;
		}
	}
	return -1;
}

function buildTableColumnWidths(colCount, headers) {
	if (colCount === 5 && findMarkColumnIndex(headers) === 4) {
		return COMPARE_TABLE_COL_WIDTHS.slice();
	}
	const each = Math.floor(10000 / colCount);
	const widths = [];
	for (let i = 0; i < colCount; i++) {
		widths.push(i === colCount - 1 ? 10000 - each * (colCount - 1) : each);
	}
	return widths;
}

function buildTableCellMarginXml() {
	const m = TABLE_CELL_MARGIN_DXA;
	return (
		'<w:tblCellMar>' +
		`<w:top w:w="${m}" w:type="dxa"/>` +
		`<w:left w:w="${m}" w:type="dxa"/>` +
		`<w:bottom w:w="${m}" w:type="dxa"/>` +
		`<w:right w:w="${m}" w:type="dxa"/>` +
		'</w:tblCellMar>'
	);
}

function buildParagraphPrXml(opts) {
	opts = opts || {};
	let inner = '';
	if (opts.align) {
		inner += `<w:jc w:val="${opts.align}"/>`;
	}
	if (!inner) return '';
	return '<w:pPr>' + inner + '</w:pPr>';
}

function buildRunXml(text, opts) {
	opts = opts || {};
	let rPr = '';
	if (opts.bold) rPr += '<w:b/>';
	if (opts.italic) rPr += '<w:i/>';
	if (opts.color) rPr += `<w:color w:val="${opts.color}"/>`;
	const rPrBlock = rPr ? `<w:rPr>${rPr}</w:rPr>` : '';
	return `<w:r>${rPrBlock}<w:t xml:space="preserve">${escapeXml(text)}</w:t></w:r>`;
}

function classifyMarkCell(text) {
	const raw = String(text || '').trim();
	if (!raw || raw === '—' || raw === '-' || /^нет$/i.test(raw)) {
		return { display: '—', color: '7F8C8D', bold: true };
	}
	if (/🔴|критич|critical/i.test(raw)) {
		return { display: raw === '🔴' ? '●' : raw, color: 'C0392B', bold: true };
	}
	if (/🟡|уточня|warn|warning/i.test(raw)) {
		return { display: raw === '🟡' ? '●' : raw, color: 'F39C12', bold: true };
	}
	if (/🟢|дополня|добавлен|added|new/i.test(raw)) {
		return { display: raw === '🟢' ? '●' : raw, color: '27AE60', bold: true };
	}
	if (/отлича|⚠|критич|diff/i.test(raw)) {
		return { display: raw.indexOf('⚠') >= 0 ? raw : '⚠ ' + (raw || 'Отличается'), color: 'C0392B', bold: true };
	}
	if (/совпад|✓|✔/i.test(raw)) {
		return { display: raw.indexOf('✓') >= 0 || raw.indexOf('✔') >= 0 ? raw : '✓ ' + (raw || 'Совпадает'), color: '27AE60', bold: true };
	}
	return { display: raw, color: '', bold: false };
}

function buildMarkRunsXml(text) {
	const mark = classifyMarkCell(text);
	return buildRunXml(mark.display, { color: mark.color || undefined, bold: mark.bold });
}

function buildTableCellXml(text, opts) {
	opts = opts || {};
	const colWidth = typeof opts.colWidth === 'number' ? opts.colWidth : 2400;
	const isHeader = !!opts.header;
	const isMarkCol = opts.colIndex === opts.markColIndex && opts.markColIndex >= 0;
	const align = isHeader || isMarkCol ? 'center' : 'left';

	let tcPr = `<w:tcW w:w="${colWidth}" w:type="dxa"/>`;
	if (isHeader) {
		tcPr += '<w:shd w:val="clear" w:color="auto" w:fill="E8ECF0"/>';
	}

	let runs;
	if (isMarkCol && !isHeader) {
		runs = buildMarkRunsXml(text);
	} else {
		runs = buildRunXml(text, { bold: isHeader });
	}

	return (
		`<w:tc><w:tcPr>${tcPr}</w:tcPr>` +
		`<w:p>${buildParagraphPrXml({ align: align })}${runs}</w:p></w:tc>`
	);
}

/**
 * @param {string[]} headers
 * @param {string[][]} rows
 * @returns {string}
 */
function buildTableXml(headers, rows) {
	const colCount = Math.max(headers.length, ...rows.map((r) => r.length), 1);
	const colWidths = buildTableColumnWidths(colCount, headers);
	const markColIndex = findMarkColumnIndex(headers);
	const grid = colWidths
		.map(function (w) {
			return `<w:gridCol w:w="${w}"/>`;
		})
		.join('');
	const borders =
		'<w:tblBorders>' +
		['top', 'left', 'bottom', 'right', 'insideH', 'insideV']
			.map(
				(edge) =>
					`<w:${edge} w:val="single" w:sz="4" w:space="0" w:color="auto"/>`
			)
			.join('') +
		'</w:tblBorders>';
	const tblPr =
		'<w:tblW w:w="5000" w:type="pct"/>' +
		borders +
		buildTableCellMarginXml();

	/** @type {string[]} */
	const trParts = [];
	if (headers.length > 0) {
		trParts.push(buildTableRowXml(headers, true, colCount, markColIndex, colWidths));
	}
	for (const row of rows) {
		trParts.push(buildTableRowXml(row, false, colCount, markColIndex, colWidths));
	}

	return (
		'<w:tbl><w:tblPr>' +
		tblPr +
		'</w:tblPr><w:tblGrid>' +
		grid +
		'</w:tblGrid>' +
		trParts.join('') +
		'</w:tbl>'
	);
}

/**
 * @param {string[]} cells
 * @param {boolean} header
 * @param {number} colCount
 * @param {number} markColIndex
 * @param {number[]} colWidths
 * @returns {string}
 */
function buildTableRowXml(cells, header, colCount, markColIndex, colWidths) {
	/** @type {string[]} */
	const tcParts = [];
	for (let i = 0; i < colCount; i++) {
		const text = cells[i] ?? '';
		tcParts.push(
			buildTableCellXml(text, {
				header: header,
				colIndex: i,
				markColIndex: markColIndex,
				colWidth: colWidths[i] || 2400
			})
		);
	}
	return `<w:tr>${tcParts.join('')}</w:tr>`;
}

/**
 * @param {string} documentXml
 * @returns {Uint8Array}
 */
function buildDocxArchive(documentXml) {
	const nsContentTypes = pkgSchemaUri('/package/2006/content-types');
	const nsRels = pkgSchemaUri('/package/2006/relationships');
	const relOfficeDoc = pkgSchemaUri('/officeDocument/2006/relationships/officeDocument');
	const relStyles = pkgSchemaUri('/officeDocument/2006/relationships/styles');
	const nsWord = pkgSchemaUri('/wordprocessingml/2006/main');
	const nsCore = pkgSchemaUri('/package/2006/metadata/core-properties');
	const nsDc = 'http://purl.org/dc/elements/1.1/';

	const documentBytes = encodeUtf8(documentXml);
	const contentTypes = encodeUtf8(
		'<?xml version="1.0" encoding="UTF-8"?>' +
			`<Types xmlns="${nsContentTypes}">` +
			'<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
			'<Default Extension="xml" ContentType="application/xml"/>' +
			'<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
			'<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>' +
			'<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>' +
			'</Types>'
	);
	const stylesXml = encodeUtf8(
		'<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
			`<w:styles xmlns:w="${nsWord}">` +
			'<w:docDefaults><w:rPrDefault><w:rPr><w:sz w:val="22"/><w:szCs w:val="22"/></w:rPr></w:rPrDefault></w:docDefaults>' +
			'<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>' +
			'<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:qFormat/><w:pPr><w:outlineLvl w:val="0"/></w:pPr><w:rPr><w:b/><w:sz w:val="32"/></w:rPr></w:style>' +
			'<w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:basedOn w:val="Normal"/><w:qFormat/><w:pPr><w:outlineLvl w:val="1"/></w:pPr><w:rPr><w:b/><w:sz w:val="28"/></w:rPr></w:style>' +
			'<w:style w:type="paragraph" w:styleId="Heading3"><w:name w:val="heading 3"/><w:basedOn w:val="Normal"/><w:qFormat/><w:pPr><w:outlineLvl w:val="2"/></w:pPr><w:rPr><w:b/><w:sz w:val="24"/></w:rPr></w:style>' +
			'</w:styles>'
	);
	const coreXml = encodeUtf8(
		'<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
			`<cp:coreProperties xmlns:cp="${nsCore}" xmlns:dc="${nsDc}">` +
			'<dc:creator>r7-docx-render</dc:creator></cp:coreProperties>'
	);
	const packageRels = encodeUtf8(
		'<?xml version="1.0" encoding="UTF-8"?>' +
			`<Relationships xmlns="${nsRels}">` +
			`<Relationship Id="rId1" Type="${relOfficeDoc}" Target="word/document.xml"/>` +
			'</Relationships>'
	);
	const documentRels = encodeUtf8(
		'<?xml version="1.0" encoding="UTF-8"?>' +
			`<Relationships xmlns="${nsRels}">` +
			`<Relationship Id="rId1" Type="${relStyles}" Target="styles.xml"/>` +
			'</Relationships>'
	);

	return createZipArchive([
		{ path: '[Content_Types].xml', data: contentTypes },
		{ path: '_rels/.rels', data: packageRels },
		{ path: 'docProps/core.xml', data: coreXml },
		{ path: 'word/document.xml', data: documentBytes },
		{ path: 'word/styles.xml', data: stylesXml },
		{ path: 'word/_rels/document.xml.rels', data: documentRels }
	]);
}

/**
 * @param {Record<string, unknown>} state
 * @param {string} vfsPath
 * @param {Uint8Array} bytes
 * @returns {Promise<{ ok: boolean, path?: string, error?: string }>}
 */
async function writeBinaryToVfs(state, vfsPath, bytes) {
	const caps = state.capabilities;
	if (!caps || typeof caps !== 'object') {
		return { ok: false, error: 'VFS недоступен: capability vfs не объявлена.' };
	}
	const raw = /** @type {Record<string, unknown>} */ (caps).vfs;
	if (!raw || typeof raw !== 'object') {
		return { ok: false, error: 'VFS недоступен в runtime.' };
	}
	const vfs = /** @type {Record<string, unknown>} */ (raw);
	try {
		if (typeof vfs.mkdir === 'function') {
			await vfs.mkdir('/workspace/out', { recursive: true });
		}
		const payload =
			typeof Buffer !== 'undefined'
				? Buffer.from(bytes)
				: bytes;
		if (typeof vfs.writeFile === 'function') {
			await vfs.writeFile(vfsPath, payload);
		} else if (typeof vfs.write === 'function') {
			await vfs.write(vfsPath, payload);
		} else {
			return { ok: false, error: 'VFS: нет writeFile/write.' };
		}
		return { ok: true, path: vfsPath };
	} catch (err) {
		return { ok: false, error: errorMessage(err) };
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
 * @param {string} name
 * @returns {string}
 */
function sanitizeFileName(name) {
	const base = String(name).trim() || 'сравнение.docx';
	return base.toLowerCase().endsWith('.docx') ? base : `${base}.docx`;
}

/**
 * @param {...unknown} values
 * @returns {string}
 */
function pickString() {
	const values = Array.from(arguments);
	for (const v of values) {
		if (typeof v === 'string' && v.trim()) return v.trim();
	}
	return '';
}

/**
 * @param {string} text
 * @returns {string}
 */
function escapeXml(text) {
	return String(text)
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;');
}

/**
 * @param {string} text
 * @returns {Uint8Array}
 */
function encodeUtf8(text) {
	return new TextEncoder().encode(text);
}

/**
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
 * @param {Array<{ path: string, data: Uint8Array }>} entries
 * @returns {Uint8Array}
 */
function createZipArchive(entries) {
	/** @type {Uint8Array[]} */
	const parts = [];
	/** @type {Array<{ path: string, offset: number, crc: number, data: Uint8Array }>} */
	const central = [];
	let offset = 0;

	for (const entry of entries) {
		const nameBytes = encodeUtf8(entry.path.replace(/\\/g, '/'));
		const crc = crc32(entry.data);
		const local = buildZipLocalHeader(nameBytes, entry.data, crc);
		parts.push(local);
		central.push({ path: entry.path, offset, crc, data: entry.data });
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
 * @param {number} centralStart
 * @returns {Uint8Array}
 */
function buildZipEndRecord(entryCount, centralSize, centralStart) {
	const footer = new Uint8Array(22);
	const view = new DataView(footer.buffer);
	view.setUint32(0, 0x06054b50, true);
	view.setUint16(4, 0, true);
	view.setUint16(6, 0, true);
	view.setUint16(8, entryCount, true);
	view.setUint16(10, entryCount, true);
	view.setUint32(12, centralSize, true);
	view.setUint32(16, centralStart, true);
	view.setUint16(20, 0, true);
	return footer;
}

/**
 * @param {Uint8Array} data
 * @returns {number}
 */
function crc32(data) {
	let crc = 0xffffffff;
	for (let i = 0; i < data.length; i++) {
		crc ^= data[i];
		for (let j = 0; j < 8; j++) {
			crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
		}
	}
	return (crc ^ 0xffffffff) >>> 0;
}

/**
 * @param {Uint8Array[]} parts
 * @returns {Uint8Array}
 */
function concatBytes(parts) {
	const total = parts.reduce((sum, p) => sum + p.length, 0);
	const out = new Uint8Array(total);
	let offset = 0;
	for (const part of parts) {
		out.set(part, offset);
		offset += part.length;
	}
	return out;
}

/**
 * @param {unknown} err
 * @returns {string}
 */
function errorMessage(err) {
	return err instanceof Error ? err.message : String(err);
}

function buildDocxBytesFromMarkdown(markdown) {
  const parsed = parseMarkdownCompareReport(markdown);
  if (!parsed.ok) return parsed;
  const report = normalizeReport({ report: parsed.report });
  if (!report.ok) return { ok: false, error: report.error };
  return {
    ok: true,
    bytes: buildCompareDocxBytes(report.data),
    fileName: report.data.fileName
  };
}

