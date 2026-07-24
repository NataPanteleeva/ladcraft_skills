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
	const content_base64 = toBase64(docxBytes);

	return {
		ok: true,
		localPath: outPath,
		fileName,
		mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
		content_base64,
		sections: sectionCount,
		tables: tableCount,
		bytes: docxBytes.length,
		agent_message: `DOCX собран: ${fileName} (${sectionCount} раздел(ов), ${tableCount} таблиц). Вызови r7_deliver_docx с content_base64 и fileName.`
	};
}

/**
 * @param {unknown} params
 * @returns {{ ok: true, data: NormalizedReport } | { ok: false, error: string }}
 */
function normalizeReport(params) {
	const raw = params && typeof params === 'object' ? /** @type {Record<string, unknown>} */ (params) : {};
	const report =
		raw.report && typeof raw.report === 'object'
			? /** @type {Record<string, unknown>} */ (raw.report)
			: raw;

	const title = pickString(report.title) || 'Сравнение документов';
	const fileName =
		pickString(report.suggestedFileName, report.outputFileName) || 'сравнение.docx';
	const sections = normalizeSections(report.sections);
	const meta = report.meta && typeof report.meta === 'object' ? /** @type {Record<string, unknown>} */ (report.meta) : null;

	/** @type {string[]} */
	const metaLines = [];
	if (meta) {
		const docA = meta.documentA;
		const docB = meta.documentB;
		if (docA && typeof docA === 'object') {
			const name = pickString(/** @type {Record<string, unknown>} */ (docA).name);
			if (name) metaLines.push(`Эталон: ${name}`);
		}
		if (docB && typeof docB === 'object') {
			const name = pickString(/** @type {Record<string, unknown>} */ (docB).name);
			if (name) metaLines.push(`Документ: ${name}`);
		}
		if (typeof meta.totalDiffs === 'number') {
			metaLines.push(`Расхождений: ${meta.totalDiffs}`);
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

/**
 * @param {string} text
 * @param {number} level
 * @returns {string}
 */
function buildHeadingXml(text, level) {
	const style = level === 1 ? 'Heading1' : level === 2 ? 'Heading2' : 'Heading3';
	const nsWord = pkgSchemaUri('/wordprocessingml/2006/main');
	return (
		`<w:p><w:pPr><w:pStyle w:val="${style}"/></w:pPr>` +
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

/**
 * @param {string[]} headers
 * @param {string[][]} rows
 * @returns {string}
 */
function buildTableXml(headers, rows) {
	const colCount = Math.max(headers.length, ...rows.map((r) => r.length), 1);
	const grid = Array.from({ length: colCount }, () => '<w:gridCol w:w="2400"/>').join('');
	const borders =
		'<w:tblBorders>' +
		['top', 'left', 'bottom', 'right', 'insideH', 'insideV']
			.map(
				(edge) =>
					`<w:${edge} w:val="single" w:sz="4" w:space="0" w:color="auto"/>`
			)
			.join('') +
		'</w:tblBorders>';

	/** @type {string[]} */
	const trParts = [];
	if (headers.length > 0) {
		trParts.push(buildTableRowXml(headers, true, colCount));
	}
	for (const row of rows) {
		trParts.push(buildTableRowXml(row, false, colCount));
	}

	return (
		'<w:tbl><w:tblPr>' +
		borders +
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
 * @returns {string}
 */
function buildTableRowXml(cells, header, colCount) {
	/** @type {string[]} */
	const tcParts = [];
	for (let i = 0; i < colCount; i++) {
		const text = cells[i] ?? '';
		const rPr = header ? '<w:rPr><w:b/></w:rPr>' : '';
		tcParts.push(
			`<w:tc><w:tcPr><w:tcW w:w="2400" w:type="dxa"/></w:tcPr>` +
				`<w:p><w:r>${rPr}<w:t xml:space="preserve">${escapeXml(text)}</w:t></w:r></w:p></w:tc>`
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
			'<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>' +
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
			`<Relationships xmlns="${nsRels}"></Relationships>`
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
	view.setUint16(8, 20, true);
	view.setUint16(26, nameBytes.length, true);
	view.setUint32(18, crc, true);
	view.setUint32(22, data.length, true);
	view.setUint32(14, data.length, true);
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
	view.setUint16(8, 20, true);
	view.setUint16(10, 20, true);
	view.setUint16(28, nameBytes.length, true);
	view.setUint32(16, crc, true);
	view.setUint32(20, data.length, true);
	view.setUint32(24, data.length, true);
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
	view.setUint16(8, entryCount, true);
	view.setUint16(10, entryCount, true);
	view.setUint32(12, centralSize, true);
	view.setUint32(16, centralStart, true);
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

/**
 * @typedef {{ heading: string, level: number, tables: ReportTable[], quotes: string[] }} ReportSection
 * @typedef {{ headers: string[], rows: string[][] }} ReportTable
 * @typedef {{ title: string, fileName: string, metaLines: string[], sections: ReportSection[] }} NormalizedReport
 */