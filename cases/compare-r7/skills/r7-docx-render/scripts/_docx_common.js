/**
 * @param {unknown} params
 * @returns {{ ok: true, data: NormalizedReport } | { ok: false, error: string }}
 */
function coerceReportObject(value) {
	if (value && typeof value === 'object') {
		return /** @type {Record<string, unknown>} */ (value);
	}
	if (typeof value === 'string' && value.trim()) {
		try {
			const parsed = JSON.parse(value);
			if (parsed && typeof parsed === 'object') {
				return /** @type {Record<string, unknown>} */ (parsed);
			}
		} catch {
			/* ignore */
		}
	}
	return null;
}

function normalizeReport(params) {
	const raw = params && typeof params === 'object' ? /** @type {Record<string, unknown>} */ (params) : {};
	const fromReportField = coerceReportObject(raw.report);
	if (raw.report != null && !fromReportField) {
		return { ok: false, error: 'report должен быть объектом CompareReport (doc-compare/v1), не JSON-строкой.' };
	}
	const report = fromReportField ?? coerceReportObject(raw) ?? raw;
	if (!report || typeof report !== 'object') {
		return { ok: false, error: 'Нужен объект CompareReport (doc-compare/v1) в поле report.' };
	}

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
 * @param {string} value
 * @returns {boolean}
 */
function isUuid(value) {
	return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}
