/* Build sales report XLSX from analytics by patching embedded template. */

function encodeUtf8(text) {
	if (typeof TextEncoder !== 'undefined') {
		return new TextEncoder().encode(text);
	}
	return Uint8Array.from(Buffer.from(text, 'utf-8'));
}

function decodeUtf8(bytes) {
	if (typeof TextDecoder !== 'undefined') {
		return new TextDecoder('utf-8').decode(bytes);
	}
	return Buffer.from(bytes).toString('utf-8');
}

function readU16(bytes, offset) {
	return bytes[offset] | (bytes[offset + 1] << 8);
}

function readU32(bytes, offset) {
	return (
		(bytes[offset] |
			(bytes[offset + 1] << 8) |
			(bytes[offset + 2] << 16) |
			(bytes[offset + 3] << 24)) >>>
		0
	);
}

function writeU16(target, offset, value) {
	target[offset] = value & 0xff;
	target[offset + 1] = (value >> 8) & 0xff;
}

function writeU32(target, offset, value) {
	target[offset] = value & 0xff;
	target[offset + 1] = (value >> 8) & 0xff;
	target[offset + 2] = (value >> 16) & 0xff;
	target[offset + 3] = (value >> 24) & 0xff;
}

function getZlib() {
	if (typeof zlib !== 'undefined' && zlib && typeof zlib.inflateRawSync === 'function') {
		return zlib;
	}
	try {
		const req = typeof require === 'function' ? require : null;
		if (req) {
			const mod = req('node:zlib') || req('zlib');
			if (mod && typeof mod.inflateRawSync === 'function' && typeof mod.deflateRawSync === 'function') {
				return mod;
			}
		}
	} catch {
		/* ignore */
	}
	return null;
}

function inflateRaw(data) {
	const z = getZlib();
	if (!z) throw new Error('zlib недоступен для распаковки XLSX.');
	return Uint8Array.from(z.inflateRawSync(data));
}

function deflateRaw(data) {
	const z = getZlib();
	if (!z) throw new Error('zlib недоступен для упаковки XLSX.');
	return Uint8Array.from(z.deflateRawSync(data));
}

function readCentralDirectory(bytes) {
	let eocdOffset = -1;
	for (let i = bytes.length - 22; i >= 0; i -= 1) {
		if (readU32(bytes, i) === 0x06054b50) {
			eocdOffset = i;
			break;
		}
	}
	if (eocdOffset < 0) {
		throw new Error('EOCD не найден в ZIP');
	}

	const totalEntries = readU16(bytes, eocdOffset + 10);
	const centralOffset = readU32(bytes, eocdOffset + 16);
	const entries = [];
	let offset = centralOffset;

	for (let i = 0; i < totalEntries; i += 1) {
		if (readU32(bytes, offset) !== 0x02014b50) {
			throw new Error('Некорректная central directory');
		}
		const compression = readU16(bytes, offset + 10);
		const crc = readU32(bytes, offset + 16);
		const compressedSize = readU32(bytes, offset + 20);
		const uncompressedSize = readU32(bytes, offset + 24);
		const nameLen = readU16(bytes, offset + 28);
		const extraLen = readU16(bytes, offset + 30);
		const commentLen = readU16(bytes, offset + 32);
		const localHeaderOffset = readU32(bytes, offset + 42);
		const name = decodeUtf8(bytes.slice(offset + 46, offset + 46 + nameLen));
		entries.push({
			name,
			compression,
			crc,
			compressedSize,
			uncompressedSize,
			localHeaderOffset
		});
		offset += 46 + nameLen + extraLen + commentLen;
	}

	return entries;
}

function readZipArchive(bytes) {
	const central = readCentralDirectory(bytes);
	return central.map((meta) => {
		const localOffset = meta.localHeaderOffset;
		if (readU32(bytes, localOffset) !== 0x04034b50) {
			throw new Error(`Некорректный local header: ${meta.name}`);
		}
		const nameLen = readU16(bytes, localOffset + 26);
		const extraLen = readU16(bytes, localOffset + 28);
		const dataStart = localOffset + 30 + nameLen + extraLen;
		const compressedData = bytes.slice(dataStart, dataStart + meta.compressedSize);
		let data;
		if (meta.compression === 0) {
			data = compressedData;
		} else if (meta.compression === 8) {
			data = inflateRaw(compressedData);
		} else {
			throw new Error(`Неподдерживаемое сжатие ZIP: ${meta.compression}`);
		}
		return {
			name: meta.name,
			compression: meta.compression,
			crc: meta.crc,
			compressedSize: meta.compressedSize,
			uncompressedSize: meta.uncompressedSize,
			compressedData,
			data,
			preserveRaw: true
		};
	});
}

const CRC_TABLE = (() => {
	const table = new Uint32Array(256);
	for (let i = 0; i < 256; i += 1) {
		let c = i;
		for (let j = 0; j < 8; j += 1) {
			c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
		}
		table[i] = c >>> 0;
	}
	return table;
})();

function crc32(bytes) {
	let crc = 0xffffffff;
	for (let i = 0; i < bytes.length; i += 1) {
		crc = (CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8)) >>> 0;
	}
	return (crc ^ 0xffffffff) >>> 0;
}

function createZipEntryFromData(name, data) {
	return { name, data, preserveRaw: false };
}

function writeZipEntries(entries) {
	const parts = [];
	const central = [];
	let offset = 0;

	for (const entry of entries) {
		const nameBytes = encodeUtf8(entry.name);
		let method = entry.compression || 0;
		let compressed;
		let uncompressed;
		let checksum = entry.crc || 0;

		if (entry.preserveRaw && entry.compressedData) {
			compressed = entry.compressedData;
			uncompressed = entry.data;
			method = entry.compression;
			if (!checksum) {
				checksum = crc32(uncompressed);
			}
		} else {
			uncompressed = entry.data;
			checksum = crc32(uncompressed);
			compressed = uncompressed;
			method = 0;
			try {
				const deflated = deflateRaw(uncompressed);
				if (deflated.length < uncompressed.length) {
					compressed = deflated;
					method = 8;
				}
			} catch {
				compressed = uncompressed;
				method = 0;
			}
		}

		const local = new Uint8Array(30 + nameBytes.length + compressed.length);
		writeU32(local, 0, 0x04034b50);
		writeU16(local, 4, 20);
		writeU16(local, 6, 0);
		writeU16(local, 8, method);
		writeU16(local, 10, 0);
		writeU16(local, 12, 0);
		writeU32(local, 14, checksum);
		writeU32(local, 18, compressed.length);
		writeU32(local, 22, uncompressed.length);
		writeU16(local, 26, nameBytes.length);
		writeU16(local, 28, 0);
		local.set(nameBytes, 30);
		local.set(compressed, 30 + nameBytes.length);
		parts.push(local);
		central.push({
			nameBytes,
			method,
			checksum,
			compressedSize: compressed.length,
			uncompressedSize: uncompressed.length,
			offset
		});
		offset += local.length;
	}

	let centralSize = 0;
	for (const entry of central) {
		const header = new Uint8Array(46 + entry.nameBytes.length);
		writeU32(header, 0, 0x02014b50);
		writeU16(header, 4, 20);
		writeU16(header, 6, 20);
		writeU16(header, 8, 0);
		writeU16(header, 10, entry.method);
		writeU16(header, 12, 0);
		writeU16(header, 14, 0);
		writeU32(header, 16, entry.checksum);
		writeU32(header, 20, entry.compressedSize);
		writeU32(header, 24, entry.uncompressedSize);
		writeU16(header, 28, entry.nameBytes.length);
		writeU16(header, 30, 0);
		writeU16(header, 32, 0);
		writeU16(header, 34, 0);
		writeU16(header, 36, 0);
		writeU32(header, 38, 0);
		writeU32(header, 42, entry.offset);
		header.set(entry.nameBytes, 46);
		parts.push(header);
		centralSize += header.length;
	}

	const end = new Uint8Array(22);
	writeU32(end, 0, 0x06054b50);
	writeU16(end, 4, 0);
	writeU16(end, 6, 0);
	writeU16(end, 8, central.length);
	writeU16(end, 10, central.length);
	writeU32(end, 12, centralSize);
	writeU32(end, 16, offset);
	writeU16(end, 20, 0);
	parts.push(end);

	const total = parts.reduce((sum, part) => sum + part.length, 0);
	const out = new Uint8Array(total);
	let cursor = 0;
	for (const part of parts) {
		out.set(part, cursor);
		cursor += part.length;
	}
	return out;
}

function decodeBase64ToBytes(b64) {
	const binary = atob(b64);
	const out = new Uint8Array(binary.length);
	for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
	return out;
}

function colLetter(index) {
	let n = index + 1;
	let s = '';
	while (n > 0) {
		const rem = (n - 1) % 26;
		s = String.fromCharCode(65 + rem) + s;
		n = Math.floor((n - 1) / 26);
	}
	return s;
}

function escapeXmlText(text) {
	return String(text)
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&apos;');
}

function cellXml(ref, value) {
	if (typeof value === 'number' && Number.isFinite(value)) {
		return `<c r="${ref}"><v>${value}</v></c>`;
	}
	return `<c r="${ref}" t="inlineStr"><is><t>${escapeXmlText(value)}</t></is></c>`;
}

function buildSheetDataXml(rows) {
	let xml = '<sheetData>';
	for (let r = 0; r < rows.length; r++) {
		const rowNum = r + 1;
		let cells = '';
		const row = rows[r] || [];
		for (let c = 0; c < row.length; c++) {
			cells += cellXml(colLetter(c) + rowNum, row[c]);
		}
		xml += `<row r="${rowNum}">${cells}</row>`;
	}
	xml += '</sheetData>';
	return xml;
}

function calcDimension(rows) {
	if (!rows.length) return 'A1:A1';
	const maxCols = rows.reduce((max, row) => Math.max(max, (row || []).length), 0);
	const endCol = colLetter(Math.max(0, maxCols - 1));
	return `A1:${endCol}${rows.length}`;
}

function patchSheetXml(originalXml, rows) {
	const sheetData = buildSheetDataXml(rows);
	const dimension = calcDimension(rows);
	let xml = originalXml.replace(/<dimension[^>]*\/>/, `<dimension ref="${dimension}"/>`);
	xml = xml.replace(/<sheetData>[\s\S]*?<\/sheetData>/, sheetData);
	return xml;
}

function padRows(rows, minRows, colCount) {
	const out = rows.slice();
	while (out.length < minRows) {
		const blank = [];
		for (let i = 0; i < colCount; i++) blank.push(i === 0 ? '' : 0);
		out.push(blank);
	}
	return out;
}

function analyticsToSheetRows(analytics) {
	const summary = analytics.summary;
	const summaryRows = [
		['Метрика', 'Значение'],
		['Число покупок (cart)', summary.purchaseCount],
		['Выручка, руб.', summary.revenue],
		['Средний чек, руб.', summary.avgCheck],
		['Уникальные покупатели', summary.uniqueBuyers]
	];

	const brandRows = [['Бренд', 'Покупки', 'Выручка, руб.', 'Доля, %']];
	for (const item of analytics.brands) {
		brandRows.push([item.brand, item.count, item.revenue, item.share]);
	}
	const brandPadded = padRows(brandRows, 11, 4);

	const categoryRows = [['Категория', 'Покупки', 'Выручка, руб.', 'Доля, %']];
	for (const item of analytics.categories) {
		categoryRows.push([item.category, item.count, item.revenue, item.share]);
	}
	const categoryPadded = padRows(categoryRows, 11, 4);

	const funnelRows = [['Этап', 'Количество', 'Конверсия, %']];
	for (const step of analytics.funnel) {
		funnelRows.push([step.stage, step.count, step.conversion]);
	}

	const dynamicsRows = [['Дата', 'Покупки', 'Выручка, руб.']];
	for (const item of analytics.dynamics) {
		dynamicsRows.push([item.date, item.count, item.revenue]);
	}
	const dynamicsPadded = padRows(dynamicsRows, 32, 3);

	return {
		'xl/worksheets/sheet1.xml': summaryRows,
		'xl/worksheets/sheet2.xml': brandPadded,
		'xl/worksheets/sheet3.xml': categoryPadded,
		'xl/worksheets/sheet4.xml': funnelRows,
		'xl/worksheets/sheet5.xml': dynamicsPadded
	};
}

function buildSalesReportXlsx(analytics) {
	if (typeof XLSX_TEMPLATE_BASE64 !== 'string' || !XLSX_TEMPLATE_BASE64) {
		throw new Error('Встроенный шаблон XLSX не найден (XLSX_TEMPLATE_BASE64).');
	}
	const templateBytes = decodeBase64ToBytes(XLSX_TEMPLATE_BASE64);
	const entries = readZipArchive(templateBytes);
	const patches = analyticsToSheetRows(analytics);
	const updated = entries.map((entry) => {
		const rows = patches[entry.name];
		if (!rows) return entry;
		const originalXml = decodeUtf8(entry.data);
		const patched = patchSheetXml(originalXml, rows);
		return createZipEntryFromData(entry.name, encodeUtf8(patched));
	});
	return writeZipEntries(updated);
}

function listReportSheets(analytics) {
	return [
		{ name: 'Сводка', table_rows: 5 },
		{ name: 'Бренды', table_rows: analytics.brands.length + 1 },
		{ name: 'Категории', table_rows: analytics.categories.length + 1 },
		{ name: 'Воронка', table_rows: analytics.funnel.length + 1 },
		{ name: 'Динамика', table_rows: analytics.dynamics.length + 1 }
	];
}
