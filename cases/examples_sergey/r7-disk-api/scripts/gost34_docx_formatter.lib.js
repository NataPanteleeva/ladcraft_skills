/* Shared GOST34 DOCX formatter (from gost34-tz-formatter). Do not edit by hand — sync from formatGost34TaskDescriptionDocx.js */
function validateTemplateBytes(bytes, templatePath) {
	if (!looksLikeZip(bytes)) {
		return {
			ok: false,
			error:
				'Шаблон прочитан не как оригинальный DOCX (нет ZIP). Ladcraft хранит DOCX как .md — нужен readFile(..., {source:"original"}). Путь: ' +
				templatePath,
		};
	}
	if (bytes.length < 50000) {
		return {
			ok: false,
			error:
				'Шаблон слишком мал (' +
				bytes.length +
				' байт) — это не полный DOCX с инженерной рамкой (~69 KB). Перезагрузите gost34_task_description_template.docx.',
		};
	}
	try {
		const entries = readZipEntries(bytes);
		const footers = entries.filter((entry) => /^word\/footer\d+\.xml$/.test(entry.name));
		const headers = entries.filter((entry) => /^word\/header\d+\.xml$/.test(entry.name));
		if (footers.length < 3 || headers.length < 3) {
			return {
				ok: false,
				error:
					'Шаблон без колонтитулов ГОСТ (footer=' +
					footers.length +
					', header=' +
					headers.length +
					'). Загрузите эталонный шаблон заново.',
			};
		}
	} catch (error) {
		return {
			ok: false,
			error: 'Шаблон повреждён: ' + String(error?.message || error),
		};
	}
	return { ok: true };
}

function looksLikeZip(bytes) {
	return bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b;
}
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
	const moduleIds = ['zlib', 'node:zlib'];
	for (let i = 0; i < moduleIds.length; i += 1) {
		try {
			const mod = require(moduleIds[i]);
			if (mod && typeof mod.inflateRawSync === 'function' && typeof mod.deflateRawSync === 'function') {
				return mod;
			}
		} catch (_) {
			// try next module id
		}
	}
	return null;
}

function inflateRaw(data) {
	const z = getZlib();
	if (!z) {
		throw new Error('zlib недоступен');
	}
	return Uint8Array.from(z.inflateRawSync(data));
}

function deflateRaw(data) {
	const z = getZlib();
	if (!z) {
		throw new Error('zlib недоступен');
	}
	return Uint8Array.from(z.deflateRawSync(data));
}

function readZipEntries(bytes) {
	const central = readCentralDirectory(bytes);
	const entries = [];
	for (const meta of central) {
		const localOffset = meta.localHeaderOffset;
		if (readU32(bytes, localOffset) !== 0x04034b50) {
			throw new Error(`Некорректный local header: ${meta.name}`);
		}
		const nameLen = readU16(bytes, localOffset + 26);
		const extraLen = readU16(bytes, localOffset + 28);
		const dataStart = localOffset + 30 + nameLen + extraLen;
		const compData = bytes.slice(dataStart, dataStart + meta.compressedSize);
		let data;
		if (meta.compression === 0) {
			data = compData;
		} else if (meta.compression === 8) {
			data = inflateRaw(compData);
		} else {
			throw new Error(`Неподдерживаемое сжатие ZIP: ${meta.compression}`);
		}
		entries.push({ name: meta.name, compression: meta.compression, data });
	}
	return entries;
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
			localHeaderOffset,
		});
		offset += 46 + nameLen + extraLen + commentLen;
	}

	return entries;
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
			preserveRaw: true,
		};
	});
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
			} catch (_) {
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
			offset,
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

function writeZip(entries) {
	return writeZipEntries(
		entries.map((entry) => {
			if (entry.preserveRaw) {
				return entry;
			}
			return createZipEntryFromData(entry.name, entry.data);
		})
	);
}

function extractDocxPlainText(bytes) {
	const entries = readZipEntries(bytes);
	const document = entries.find((entry) => entry.name === 'word/document.xml');
	if (!document) {
		return '';
	}
	const xml = decodeUtf8(document.data);
	const chunks = [];
	const regex = /<w:t[^>]*>([\s\S]*?)<\/w:t>/g;
	let match = regex.exec(xml);
	while (match) {
		chunks.push(
			match[1]
				.replace(/&lt;/g, '<')
				.replace(/&gt;/g, '>')
				.replace(/&amp;/g, '&')
				.replace(/&quot;/g, '"')
				.replace(/&apos;/g, "'")
		);
		match = regex.exec(xml);
	}
	return chunks.join('\n');
}

function buildDocxFromTemplate(templateBytes, inputSectionMap, meta) {
	const archive = readZipArchive(templateBytes);
	const document = archive.find((entry) => entry.name === 'word/document.xml');
	if (!document) {
		throw new Error('word/document.xml не найден в шаблоне');
	}
	const templateXml = decodeUtf8(document.data);
	const merged = mergeTemplateDocument(templateXml, inputSectionMap, meta);
	const updated = archive.map((entry) => {
		if (entry.name === 'word/document.xml') {
			return createZipEntryFromData(entry.name, encodeUtf8(merged.xml));
		}
		if (/^word\/(header|footer)\d+\.xml$/.test(entry.name)) {
			const filled = fillTitlePlaceholders(decodeUtf8(entry.data), meta);
			return createZipEntryFromData(entry.name, encodeUtf8(filled));
		}
		return entry;
	});
	return {
		bytes: writeZipEntries(updated),
		fillStats: merged.fillStats,
		recommendations: merged.recommendations,
	};
}

function extractDocumentParagraphs(bytes) {
	const entries = readZipEntries(bytes);
	const document = entries.find((entry) => entry.name === 'word/document.xml');
	if (!document) {
		return [];
	}
	return parseDocumentParagraphs(decodeUtf8(document.data));
}

function parseDocumentParagraphs(xml) {
	const paragraphs = xml.match(/<w:p[\s\S]*?<\/w:p>/g) || [];
	return paragraphs.map((paragraphXml) => {
		const style = (paragraphXml.match(/w:pStyle w:val="([^"]+)"/) || [])[1] || '';
		const jc = (paragraphXml.match(/w:jc w:val="([^"]+)"/) || [])[1] || '';
		const text = sanitizeParagraphText(extractParagraphText(paragraphXml));
		return { xml: paragraphXml, style, jc, text };
	});
}

function extractParagraphText(paragraphXml) {
	const parts = [];
	const regex = /<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g;
	let match = regex.exec(paragraphXml);
	while (match) {
		parts.push(match[1]);
		match = regex.exec(paragraphXml);
	}
	return sanitizeParagraphText(parts.join(''));
}

function sanitizeParagraphText(text) {
	return decodeXmlText(text)
		.replace(/<[^>]*>/g, ' ')
		.replace(/\s+/g, ' ')
		.trim();
}

function decodeXmlText(text) {
	return String(text || '')
		.replace(/&lt;/g, '<')
		.replace(/&gt;/g, '>')
		.replace(/&amp;/g, '&')
		.replace(/&quot;/g, '"')
		.replace(/&apos;/g, "'");
}

function getHeadingLevel(style) {
	const normalized = String(style || '');
	const headingMatch = normalized.match(/^Heading(\d+)$/);
	if (headingMatch) {
		return Number(headingMatch[1]);
	}
	if (normalized === '1') {
		return 1;
	}
	if (normalized === '20') {
		return 2;
	}
	if (normalized === '3' || normalized === '41') {
		return 3;
	}
	return 0;
}

function isTemplateHeading(paragraph) {
	return getHeadingLevel(paragraph.style) > 0;
}

function normalizeHeadingKey(text) {
	return sanitizeParagraphText(text)
		.toLowerCase()
		.replace(/^\d+([.)]\d+)*[.)]?\s*/, '')
		.trim();
}

function isTocParagraph(paragraph) {
	if (/^TOC\d?$/.test(paragraph.style)) {
		return true;
	}
	if (['10', '11', '21', '30'].includes(paragraph.style)) {
		return true;
	}
	const text = paragraph.text.toLowerCase();
	if (text === 'содержание') {
		return true;
	}
	return text.indexOf('toc \\o') >= 0 || text.indexOf('pageref') >= 0;
}

function isInstructionParagraph(paragraph) {
	if (paragraph.style === 'a2' || paragraph.style === 'a') {
		return true;
	}
	const text = paragraph.text.trim();
	if (text.indexOf('2.6.') >= 0) {
		return true;
	}
	if (text.indexOf('Настоящий шаблон устанавливает') >= 0) {
		return true;
	}
	if (text.indexOf('Раздел не обязателен') >= 0) {
		return true;
	}
	if (text.indexOf('следует переименовать') >= 0) {
		return true;
	}
	if (text.indexOf('следует изменить') >= 0) {
		return true;
	}
	return false;
}

function isBodyFillStyle(paragraph) {
	const style = paragraph.style;
	if (['BodyTextIndent', 'UserStyle_25', 'af6', 'aff5', 'TableHeading'].includes(style)) {
		return true;
	}
	if (!style && isTemplateFillSlot(paragraph)) {
		return true;
	}
	return false;
}

function isTemplateFillSlot(paragraph) {
	const text = paragraph.text.trim();
	const short = text.toLowerCase();
	if (short === 'текст' || short === 'текст.' || short === 'текст:') {
		return true;
	}
	if (/^<[^>]+>$/.test(text)) {
		return true;
	}
	if (text.indexOf('Полное наименование организации') >= 0) {
		return true;
	}
	return false;
}

function buildSectionMapFromParagraphs(paragraphs) {
	const map = {};
	const stack = [];
	let currentKey = '';
	let buffer = [];

	const flush = () => {
		if (!currentKey || buffer.length === 0) {
			return;
		}
		const content = buffer.join('\n').trim();
		if (content) {
			map[currentKey] = content;
		}
		buffer = [];
	};

	for (const paragraph of paragraphs) {
		const level = getHeadingLevel(paragraph.style);
		if (level > 0) {
			flush();
			stack.length = level - 1;
			stack[level - 1] = normalizeHeadingKey(paragraph.text);
			currentKey = stack.join('|');
			if (level === 1 && paragraph.text.trim()) {
				map.__title__ = paragraph.text.trim();
			}
			continue;
		}
		if (currentKey && paragraph.text.trim() && !isInstructionParagraph(paragraph)) {
			buffer.push(paragraph.text.trim());
		}
	}
	flush();
	return map;
}

function mergeLegacySectionsIntoMap(map, legacy) {
	if (legacy.characteristics) {
		map.__legacy_characteristics__ = legacy.characteristics;
	}
	if (legacy.outputInfo) {
		map.__legacy_output__ = legacy.outputInfo;
	}
	if (legacy.inputInfo) {
		map.__legacy_input__ = legacy.inputInfo;
	}
	if (legacy.title) {
		map.__title__ = legacy.title;
	}
}

function mergeSectionMaps(target, source) {
	for (const key of Object.keys(source)) {
		if (key.indexOf('__') === 0) {
			continue;
		}
		if (!target[key] && source[key]) {
			target[key] = source[key];
		}
	}
}

function extractInputSectionsByHeading(paragraphs) {
	const byPath = {};
	const byKey = {};
	let intro = '';
	const stack = [];
	let currentPath = '';
	let buffer = [];

	const flush = () => {
		if (!currentPath || buffer.length === 0) {
			return;
		}
		const content = buffer.join('\n').trim();
		if (!content) {
			return;
		}
		byPath[currentPath] = content;
		const lastKey = normalizeHeadingKey(currentPath.split('|').pop() || '');
		if (lastKey && !byKey[lastKey]) {
			byKey[lastKey] = content;
		}
	};

	for (const paragraph of paragraphs) {
		const level = getHeadingLevel(paragraph.style);
		if (level > 0) {
			flush();
			buffer = [];
			stack.length = level - 1;
			stack[level - 1] = normalizeHeadingKey(paragraph.text);
			currentPath = stack.filter(Boolean).join('|');
			continue;
		}
		const text = paragraph.text.trim();
		if (!text) {
			continue;
		}
		if (!currentPath) {
			intro = intro ? `${intro}\n${text}` : text;
			continue;
		}
		buffer.push(text);
	}
	flush();
	return { byPath, byKey, intro };
}

function pickInputSection(input, candidates) {
	for (const candidate of candidates) {
		const normalized = normalizeHeadingKey(candidate);
		if (input.byKey[normalized]) {
			return input.byKey[normalized];
		}
		for (const path of Object.keys(input.byPath)) {
			const pathNorm = normalizeHeadingKey(path);
			const last = normalizeHeadingKey(path.split('|').pop() || '');
			if (
				pathNorm.indexOf(normalized) >= 0 ||
				normalized.indexOf(last) >= 0 ||
				last.indexOf(normalized) >= 0
			) {
				return input.byPath[path];
			}
		}
	}
	return '';
}

function joinSections(...parts) {
	return parts
		.map((part) => String(part || '').trim())
		.filter(Boolean)
		.join('\n\n');
}

function sanitizeMappedContent(text) {
	const cleaned = String(text || '')
		.replace(/[\uE000-\uF8FF]/g, '')
		.replace(/```[\s\S]*?```/g, ' ')
		.replace(/flowchart\s+\w+[\s\S]*/gi, ' ')
		.replace(/\s+/g, ' ')
		.trim();
	if (!cleaned || cleaned.length < 20) {
		return '';
	}
	return cleaned;
}

function buildMissingSectionPlaceholder(stack) {
	const labels = stack
		.filter(Boolean)
		.map((key) => formatSectionLabel(key));
	const path = labels.length ? labels.join(' → ') : 'раздел без заголовка';
	return `Необходимо добавить текст: ${path}.`;
}

function formatSectionLabel(normalizedKey) {
	const text = String(normalizedKey || '').trim();
	if (!text) {
		return 'раздел';
	}
	return text.charAt(0).toUpperCase() + text.slice(1);
}

function setMapContent(map, key, content) {
	const trimmed = String(content || '').trim();
	if (trimmed) {
		map[key] = trimmed;
	}
}

function buildSemanticGostMap(inputParagraphs, projectName) {
	const input = extractInputSectionsByHeading(inputParagraphs);
	const map = {};
	const major = 'характеристики комплекса задач';
	const outputMajor = 'выходная информация';
	const inputMajor = 'входная информация';

	setMapContent(
		map,
		`${major}|назначение комплекса задач`,
		joinSections(
			sanitizeMappedContent(pickInputSection(input, ['назначение', 'введение'])),
			sanitizeMappedContent(input.intro)
		)
	);
	setMapContent(
		map,
		`${major}|перечень объектов при управлении которыми решают комплекс задач`,
		sanitizeMappedContent(
			pickInputSection(input, [
				'справочник объектов расширения',
				'настройка определяемого типа «объект интеграции»',
				'состав типа в поставке расширения',
				'размещение команды на формах документов',
				'возможности расширения',
			])
		)
	);
	setMapContent(
		map,
		`${major}|периодичность и продолжительность решения`,
		sanitizeMappedContent(pickInputSection(input, ['порядок первого запуска', 'периодичность']))
	);
	setMapContent(
		map,
		`${major}|условия, при которых прекращается решение комплекса задач автоматизированным способом (при необходимости)`,
		sanitizeMappedContent(pickInputSection(input, ['устранение неполадок', 'ограничения', 'прекращается']))
	);
	setMapContent(
		map,
		`${major}|связи данного комплекса задач с другими комплексами (задачами) ас`,
		sanitizeMappedContent(pickInputSection(input, ['связи', 'назначение', 'требования']))
	);
	setMapContent(
		map,
		`${major}|должности лиц и (или) наименования подразделений`,
		sanitizeMappedContent(
			pickInputSection(input, ['должности', 'подразделений', 'подключение пользователя р7', 'для администратора'])
		)
	);
	setMapContent(
		map,
		`${major}|распределение действий между персоналом и техническими средствами при различных ситуациях решения комплекса задач`,
		joinSections(
			sanitizeMappedContent(pickInputSection(input, ['в режиме «конфигуратор»', 'подключение расширения'])),
			sanitizeMappedContent(pickInputSection(input, ['в пользовательском режиме', 'настройка сервера']))
		)
	);
	setMapContent(
		map,
		`${major}|распределение действий между персоналом и техническими средствами при различных ситуациях решения комплекса задач|раздел`,
		joinSections(
			sanitizeMappedContent(pickInputSection(input, ['сценарий для пользователя', 'сценарий использования'])),
			sanitizeMappedContent(pickInputSection(input, ['форма «управление файлами»', 'механизм присоединённых файлов р7']))
		)
	);

	setMapContent(
		map,
		`${outputMajor}|перечень и описание выходных сообщений`,
		sanitizeMappedContent(
			pickInputSection(input, [
				'выходная информация',
				'форма «печать документов» и выгрузка в р7',
				'сценарий использования',
				'форма «управление файлами»',
				'механизм присоединённых файлов р7',
			])
		)
	);
	setMapContent(
		map,
		`${outputMajor}|перечень и описание структурных единиц информации выходных сообщений`,
		sanitizeMappedContent(pickInputSection(input, ['печать в р7', 'выгрузка', 'присоединённые файлы', 'структурных единиц']))
	);

	setMapContent(
		map,
		`${inputMajor}|перечень и описание входных сообщений`,
		sanitizeMappedContent(
			pickInputSection(input, [
				'входная информация',
				'настройка сервера',
				'подключение пользователя р7',
				'механизм присоединённых файлов р7',
				'сценарий для пользователя',
			])
		)
	);
	setMapContent(
		map,
		`${inputMajor}|перечень и описание структурных единиц информации входных сообщений`,
		sanitizeMappedContent(
			pickInputSection(input, ['объект интеграции', 'состав типа в поставке расширения', 'структурных единиц'])
		)
	);

	if (projectName) {
		map.__title__ = projectName;
	}
	return map;
}

function splitBodyContent(templateXml) {
	const bodyStart = templateXml.indexOf('<w:body>');
	const bodyEnd = templateXml.indexOf('</w:body>');
	if (bodyStart < 0 || bodyEnd < 0) {
		throw new Error('Некорректный шаблон: отсутствует w:body');
	}
	return {
		prefix: templateXml.slice(0, bodyStart + 8),
		suffix: templateXml.slice(bodyEnd),
		content: templateXml.slice(bodyStart + 8, bodyEnd),
	};
}

function parseTopLevelBodyBlocks(content) {
	const blocks = [];
	let pos = 0;
	while (pos < content.length) {
		const relP = content.indexOf('<w:p', pos);
		const relTbl = content.indexOf('<w:tbl', pos);
		const relSect = content.indexOf('<w:sectPr', pos);
		const candidates = [
			relP >= 0 ? { start: relP, tag: 'p' } : null,
			relTbl >= 0 ? { start: relTbl, tag: 'tbl' } : null,
			relSect >= 0 ? { start: relSect, tag: 'sectPr' } : null,
		].filter(Boolean);
		if (candidates.length === 0) {
			break;
		}
		candidates.sort((a, b) => a.start - b.start);
		const { start, tag } = candidates[0];
		const end = findMatchingElementEnd(content, start, tag);
		if (end < 0) {
			break;
		}
		blocks.push({ type: tag, xml: content.slice(start, end) });
		pos = end;
	}
	return blocks;
}

function isElementOpen(xml, index, tag) {
	const open = `<w:${tag}`;
	if (!xml.startsWith(open, index)) {
		return false;
	}
	const next = xml[index + open.length];
	return next === '>' || next === ' ' || next === '/';
}

function findMatchingElementEnd(xml, start, tag) {
	if (!isElementOpen(xml, start, tag)) {
		return -1;
	}
	const open = `<w:${tag}`;
	let scan = start + open.length;
	while (scan < xml.length) {
		const ch = xml[scan];
		if (ch === '>' && xml[scan - 1] === '/') {
			return scan + 1;
		}
		if (ch === '>') {
			break;
		}
		scan += 1;
	}
	const close = `</w:${tag}>`;
	let depth = 1;
	for (let i = scan + 1; i < xml.length; i += 1) {
		if (isElementOpen(xml, i, tag)) {
			const innerEnd = findMatchingElementEnd(xml, i, tag);
			if (innerEnd < 0) {
				return -1;
			}
			i = innerEnd - 1;
			continue;
		}
		if (xml.startsWith(close, i)) {
			depth -= 1;
			if (depth === 0) {
				return i + close.length;
			}
			i += close.length - 1;
		}
	}
	return -1;
}

function parseParagraphBlock(paragraphXml) {
	const style = (paragraphXml.match(/w:pStyle w:val="([^"]+)"/) || [])[1] || '';
	const jc = (paragraphXml.match(/w:jc w:val="([^"]+)"/) || [])[1] || '';
	const text = sanitizeParagraphText(extractParagraphText(paragraphXml));
	return { xml: paragraphXml, style, jc, text };
}

function isMainContentHeading(paragraph) {
	const level = getHeadingLevel(paragraph.style);
	if (level !== 1) {
		return false;
	}
	const text = normalizeHeadingKey(paragraph.text);
	return text.indexOf('характеристики комплекса') >= 0;
}

function ensurePageBreakBefore(paragraphXml) {
	if (paragraphXml.indexOf('w:pageBreakBefore') >= 0 || paragraphXml.indexOf('w:type="page"') >= 0) {
		return paragraphXml;
	}
	const pPrMatch = paragraphXml.match(/<w:pPr[\s\S]*?<\/w:pPr>/);
	if (pPrMatch) {
		return paragraphXml.replace(
			pPrMatch[0],
			pPrMatch[0].replace('</w:pPr>', '<w:pageBreakBefore/></w:pPr>')
		);
	}
	return paragraphXml.replace('<w:p>', '<w:p><w:pPr><w:pageBreakBefore/></w:pPr>');
}

function findContentForSection(inputMap, stack) {
	const key = stack.join('|');
	if (inputMap[key]) {
		return inputMap[key];
	}
	const last = normalizeHeadingKey(stack[stack.length - 1] || '');
	if (!last) {
		return '';
	}
	for (const entryKey of Object.keys(inputMap)) {
		if (entryKey.indexOf('__') === 0) {
			continue;
		}
		if (entryKey === last || entryKey.endsWith(`|${last}`)) {
			return inputMap[entryKey];
		}
	}
	return '';
}

function mergeTemplateDocument(templateXml, inputMap, meta) {
	const { prefix, suffix, content } = splitBodyContent(templateXml);
	const blocks = parseTopLevelBodyBlocks(content);
	const stack = [];
	const out = [];
	const fillStats = { filled: 0, missing: 0 };
	const recommendations = [];
	const recommendationSet = new Set();
	let inMainContent = false;

	for (const block of blocks) {
		if (block.type === 'tbl' || block.type === 'sectPr') {
			if (block.type === 'tbl') {
				out.push(fillTitlePlaceholders(block.xml, meta));
			} else {
				out.push(block.xml);
			}
			continue;
		}

		const paragraph = parseParagraphBlock(block.xml);
		let paragraphXml = paragraph.xml;

		if (!inMainContent) {
			if (isMainContentHeading(paragraph)) {
				inMainContent = true;
				paragraphXml = ensurePageBreakBefore(fillTitlePlaceholders(paragraphXml, meta));
				stack.length = 0;
				stack[0] = normalizeHeadingKey(paragraph.text);
				out.push(paragraphXml);
				continue;
			}
			if (isTocParagraph(paragraph)) {
				out.push(fillTitlePlaceholders(paragraphXml, meta));
				continue;
			}
			if (isInstructionParagraph(paragraph)) {
				continue;
			}
			out.push(fillTitlePlaceholders(paragraphXml, meta));
			continue;
		}

		if (isTocParagraph(paragraph) || isInstructionParagraph(paragraph)) {
			continue;
		}

		const level = getHeadingLevel(paragraph.style);
		if (level > 0) {
			stack.length = level - 1;
			stack[level - 1] = normalizeHeadingKey(paragraph.text);
			if (level === 1) {
				paragraphXml = ensurePageBreakBefore(paragraphXml);
			}
			out.push(paragraphXml);
			continue;
		}

		if (isTemplateFillSlot(paragraph) && isBodyFillStyle(paragraph)) {
			let slotContent = findContentForSection(inputMap, stack);
			if (!slotContent) {
				slotContent = buildMissingSectionPlaceholder(stack);
				fillStats.missing += 1;
				const label = stack.filter(Boolean).join(' > ') || 'Раздел без заголовка';
				const recommendation = `Добавить содержимое в раздел: ${label}`;
				if (!recommendationSet.has(recommendation)) {
					recommendationSet.add(recommendation);
					recommendations.push(recommendation);
				}
			} else {
				fillStats.filled += 1;
			}
			out.push(replaceParagraphText(paragraphXml, slotContent));
			continue;
		}

		out.push(paragraphXml);
	}

	const xml = prefix + out.join('') + suffix;
	return { xml, fillStats, recommendations };
}

function fillTitlePlaceholders(xml, meta) {
	const year = String(new Date().getFullYear());
	const organization = escapeXml(meta.organization || 'Заполнить.');
	const systemName = escapeXml(meta.systemName || 'Заполнить.');
	const cipher = escapeXml(meta.cipher || 'Заполнить.');

	let result = String(xml || '')
		.replace(/20ХХ/g, year)
		.replace(/<ГОД>/g, year)
		.replace(/ХХХ\.П4/g, cipher)
		.replace(/>НАИМЕНОВАНИЕ ОРГАНИЗАЦИИ ЗАКАЗЧИКА</g, `>${organization}<`)
		.replace(/>НАИМЕНОВАНИЕ СИСТЕМЫ \/ ПОДСИСТЕМЫ</g, `>${systemName}<`)
		.replace(/&lt;НАИМЕНОВАНИЕ СИСТЕМЫ \/ ПОДСИСТЕМЫ&gt;/gi, systemName)
		.replace(/&lt;НАИМЕНОВАНИЕ ОРГАНИЗАЦИИ ЗАКАЗЧИКА&gt;/gi, organization)
		.replace(/&lt;Наименование системы\/подсистемы&gt;/gi, systemName)
		.replace(/&lt;Шифр темы&gt;/gi, cipher)
		.replace(/&lt;НаименованиеОрганизацииШапка&gt;/gi, organization)
		.replace(/&lt;Наименование АС&gt;/gi, systemName);

	result = result.replace(
		/<w:t>&lt;<\/w:t><\/w:r><w:r(?:\s[^>]*)?><w:t>ГОД<\/w:t><\/w:r><w:r(?:\s[^>]*)?><w:t>&gt;<\/w:t>/gi,
		`<w:t>${year}</w:t>`
	);

	return result;
}

function inferTitleMetaFromInput(paragraphs, projectName) {
	const result = { systemName: '', organization: '', cipher: '' };
	if (projectName) {
		result.systemName = projectName;
	}

	const texts = (paragraphs || [])
		.map((paragraph) => String(paragraph?.text || '').trim())
		.filter(Boolean);

	for (const text of texts.slice(0, 40)) {
		const cipherMatch = text.match(/\b([A-ZА-ЯЁ0-9][\wА-Яа-яЁё.-]{1,30}\.П\d+)\b/);
		if (cipherMatch && !result.cipher) {
			result.cipher = cipherMatch[1];
		}

		const orgMatch = text.match(
			/(?:организаци[яи]\s+заказчик[ае]?|заказчик)\s*[:—-]\s*(.+)$/i
		);
		if (orgMatch && !result.organization) {
			result.organization = orgMatch[1].trim();
		}

		const systemMatch = text.match(
			/(?:наименование\s+(?:системы|подсистемы|ас)|система\/подсистема)\s*[:—-]\s*(.+)$/i
		);
		if (systemMatch && !result.systemName) {
			result.systemName = systemMatch[1].trim();
		}
	}

	if (!result.systemName) {
		const titleCandidate = texts.find(
			(text) =>
				text.length >= 8 &&
				text.length <= 180 &&
				!/^(описание|инструкция|содержание|утвержден|лист|гост|форма)\b/i.test(text)
		);
		if (titleCandidate) {
			result.systemName = titleCandidate;
		}
	}

	return result;
}

function replaceParagraphText(paragraphXml, newText) {
	const pPrMatch = paragraphXml.match(/<w:pPr[\s\S]*?<\/w:pPr>/);
	const pPr = pPrMatch ? pPrMatch[0] : '';
	const rPrMatch = paragraphXml.match(/<w:rPr[\s\S]*?<\/w:rPr>/);
	const rPr = rPrMatch ? rPrMatch[0] : '';
	const lines = String(newText || 'Заполнить.').split('\n');
	let runs = '';
	for (let i = 0; i < lines.length; i += 1) {
		runs += `<w:r>${rPr}<w:t xml:space="preserve">${escapeXml(lines[i])}</w:t></w:r>`;
		if (i < lines.length - 1) {
			runs += `<w:r>${rPr}<w:br/></w:r>`;
		}
	}
	return `<w:p>${pPr}${runs}</w:p>`;
}
function escapeXml(text) {
	return String(text)
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&apos;');
}
function normalizeTaskDescriptionContent(rawText, projectName) {
	const cleaned = cleanText(rawText);
	const sections = splitTaskDescriptionSections(cleaned);
	return {
		title: projectName || sections.title || 'Заполнить.',
		characteristics: sections.characteristics,
		outputInfo: sections.outputInfo,
		inputInfo: sections.inputInfo,
	};
}

function splitTaskDescriptionSections(text) {
	const lowered = text.toLowerCase();
	const byHeadings = splitSectionsByHeadings(text);
	if (byHeadings.hasUsefulSections) {
		return {
			title: byHeadings.title,
			characteristics: byHeadings.grounds || byHeadings.purpose || '',
			outputInfo: byHeadings.requirements || '',
			inputInfo: byHeadings.attachments || '',
		};
	}

	const lines = text
		.split('\n')
		.map((line) => line.trim())
		.filter(Boolean);

	return {
		title: lines[0] || '',
		characteristics: extractByMarkers(text, lowered, ['характеристик', 'назначение комплекса', 'комплекс задач'], [
			'выходная информация',
			'входная информация',
		]),
		outputInfo: extractByMarkers(text, lowered, ['выходная информация', 'выходн'], ['входная информация', 'входн']),
		inputInfo: extractByMarkers(text, lowered, ['входная информация', 'входн'], []),
	};
}

function normalizeGost34Content(rawText, projectName) {
	return normalizeTaskDescriptionContent(rawText, projectName);
}

function cleanText(text) {
	return String(text || '')
		.replace(/\r\n/g, '\n')
		.replace(/\u0000/g, ' ')
		.replace(/[ \t]+\n/g, '\n')
		.replace(/\n{3,}/g, '\n\n')
		.trim();
}

function splitSections(text) {
	const byHeadings = splitSectionsByHeadings(text);
	if (byHeadings.hasUsefulSections) {
		return byHeadings;
	}

	const lowered = text.toLowerCase();
	const result = {
		title: '',
		project: '',
		grounds: extractByMarkers(text, lowered, ['основан', 'основание'], ['назначение', 'цель']),
		purpose: extractByMarkers(text, lowered, ['назначение', 'цель'], ['требован', 'характерист']),
		requirements: extractByMarkers(text, lowered, ['требован', 'характерист'], ['состав работ', 'этап']),
		works: extractByMarkers(text, lowered, ['состав работ', 'этап'], ['порядок контроля', 'приемк']),
		acceptance: extractByMarkers(text, lowered, ['порядок контроля', 'приемк'], ['приложен', 'перечень']),
		attachments: extractByMarkers(text, lowered, ['приложен', 'перечень'], []),
	};

	const lines = text
		.split('\n')
		.map((line) => line.trim())
		.filter(Boolean);
	if (lines.length > 0) {
		result.title = lines[0];
	}
	if (lines.length > 1) {
		result.project = lines[1];
	}

	return result;
}

function splitSectionsByHeadings(text) {
	const lines = text
		.split('\n')
		.map((line) => line.trim())
		.filter(Boolean);
	const sections = [];
	let current = null;

	for (const line of lines) {
		const sectionKey = detectSectionKey(line);
		if (sectionKey) {
			if (current) {
				sections.push(current);
			}
			current = { key: sectionKey, content: [] };
			continue;
		}
		if (current) {
			current.content.push(line);
		}
	}
	if (current) {
		sections.push(current);
	}

	const mapped = {
		title: lines[0] || '',
		project: lines[1] || '',
		grounds: '',
		purpose: '',
		requirements: '',
		works: '',
		acceptance: '',
		attachments: '',
		hasUsefulSections: false,
	};

	for (const section of sections) {
		const content = section.content.join('\n').trim();
		if (!content) {
			continue;
		}
		mapped.hasUsefulSections = true;
		mapped[section.key] = content;
	}

	return mapped;
}

function detectSectionKey(line) {
	const normalized = line.toLowerCase().replace(/\s+/g, ' ').trim();
	const heading = normalized.replace(/^\d+([.)]\d+)*[.)]?\s*/, '');

	if (
		heading.indexOf('основан') >= 0 ||
		heading.indexOf('основание') >= 0 ||
		heading.indexOf('для разработки') >= 0
	) {
		return 'grounds';
	}
	if (heading.indexOf('назначен') >= 0 || heading.indexOf('цел') >= 0) {
		return 'purpose';
	}
	if (heading.indexOf('требован') >= 0 || heading.indexOf('характерист') >= 0) {
		return 'requirements';
	}
	if (heading.indexOf('состав') >= 0 || heading.indexOf('этап') >= 0 || heading.indexOf('работ') >= 0) {
		return 'works';
	}
	if (
		heading.indexOf('контрол') >= 0 ||
		heading.indexOf('приемк') >= 0 ||
		heading.indexOf('приёмк') >= 0
	) {
		return 'acceptance';
	}
	if (heading.indexOf('приложен') >= 0 || heading.indexOf('перечень') >= 0) {
		return 'attachments';
	}

	return '';
}

function extractByMarkers(source, sourceLower, startMarkers, endMarkers) {
	let start = -1;
	for (const marker of startMarkers) {
		const idx = sourceLower.indexOf(marker);
		if (idx >= 0 && (start < 0 || idx < start)) {
			start = idx;
		}
	}
	if (start < 0) {
		return '';
	}

	let end = source.length;
	for (const marker of endMarkers) {
		const idx = sourceLower.indexOf(marker, start + 1);
		if (idx >= 0 && idx < end) {
			end = idx;
		}
	}

	return source.slice(start, end).trim();
}
