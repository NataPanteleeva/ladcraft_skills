/* CSV parser and sales analytics aggregations for analytics_csv. */

const EMPTY_BRAND_LABEL = '(без бренда)';
const EMPTY_CATEGORY_LABEL = '(без категории)';

function parseCsvSemicolon(text) {
	const lines = String(text || '')
		.replace(/^\uFEFF/, '')
		.split(/\r?\n/)
		.filter((line) => line.trim());
	if (lines.length < 2) {
		return { ok: false, error: 'CSV пуст или содержит только заголовок.' };
	}
	const headers = lines[0].split(';').map((h) => h.trim());
	const rows = [];
	for (let i = 1; i < lines.length; i++) {
		const parts = lines[i].split(';');
		const row = {};
		for (let c = 0; c < headers.length; c++) {
			row[headers[c]] = (parts[c] ?? '').trim();
		}
		rows.push(row);
	}
	return { ok: true, headers, rows };
}

function parsePrice(value) {
	if (typeof value === 'number' && Number.isFinite(value)) return value;
	const normalized = String(value || '')
		.trim()
		.replace(/\s/g, '')
		.replace(',', '.');
	const num = Number(normalized);
	return Number.isFinite(num) ? num : 0;
}

function parseEventDate(value) {
	const raw = String(value || '').trim();
	const match = raw.match(/^(\d{4}-\d{2}-\d{2})/);
	if (match) return match[1];
	const d = new Date(raw);
	if (!Number.isNaN(d.getTime())) {
		return (
			String(d.getUTCFullYear()) +
			'-' +
			String(d.getUTCMonth() + 1).padStart(2, '0') +
			'-' +
			String(d.getUTCDate()).padStart(2, '0')
		);
	}
	return raw.slice(0, 10) || 'unknown';
}

function normalizeBrand(value) {
	const brand = String(value || '').trim();
	return brand || EMPTY_BRAND_LABEL;
}

function normalizeCategory(value) {
	const code = String(value || '').trim();
	if (!code) return { full: EMPTY_CATEGORY_LABEL, top: EMPTY_CATEGORY_LABEL };
	const top = code.split('.')[0] || code;
	return { full: code, top };
}

function filterByEventType(rows, eventType) {
	return rows.filter((row) => String(row.event_type || '').trim().toLowerCase() === eventType);
}

function round2(num) {
	return Math.round(num * 100) / 100;
}

function buildTopList(items, totalCount, limit) {
	const sorted = items.slice().sort((a, b) => b.count - a.count || b.revenue - a.revenue);
	const top = sorted.slice(0, limit);
	return top.map((item) => ({
		...item,
		share: totalCount > 0 ? round2((item.count / totalCount) * 100) : 0
	}));
}

function aggregateMap(rows, keyFn) {
	const map = new Map();
	for (const row of rows) {
		const key = keyFn(row);
		const price = parsePrice(row.price);
		const entry = map.get(key) || { key, count: 0, revenue: 0 };
		entry.count += 1;
		entry.revenue = round2(entry.revenue + price);
		map.set(key, entry);
	}
	return Array.from(map.values());
}

function computeAnalyticsFromRows(rows) {
	const purchases = filterByEventType(rows, 'cart');
	const views = filterByEventType(rows, 'view');
	const purchaseEvents = filterByEventType(rows, 'purchase');

	const purchaseCount = purchases.length;
	const revenue = round2(purchases.reduce((sum, row) => sum + parsePrice(row.price), 0));
	const uniqueBuyers = new Set(purchases.map((row) => row.user_id).filter(Boolean)).size;
	const avgCheck = purchaseCount > 0 ? round2(revenue / purchaseCount) : 0;

	const viewCount = views.length;
	const funnelPurchaseCount = purchaseEvents.length;
	const funnelConversion =
		viewCount > 0 ? round2((funnelPurchaseCount / viewCount) * 100) : 0;

	const brandItems = buildTopList(
		aggregateMap(purchases, (row) => normalizeBrand(row.brand)),
		purchaseCount,
		10
	).map((item) => ({
		brand: item.key,
		count: item.count,
		revenue: item.revenue,
		share: item.share
	}));

	const categoryItems = buildTopList(
		aggregateMap(purchases, (row) => normalizeCategory(row.category_code).top),
		purchaseCount,
		10
	).map((item) => ({
		category: item.key,
		count: item.count,
		revenue: item.revenue,
		share: item.share
	}));

	const dynamicsMap = new Map();
	for (const row of purchases) {
		const date = parseEventDate(row.event_time);
		const entry = dynamicsMap.get(date) || { date, count: 0, revenue: 0 };
		entry.count += 1;
		entry.revenue = round2(entry.revenue + parsePrice(row.price));
		dynamicsMap.set(date, entry);
	}
	const dynamics = Array.from(dynamicsMap.values()).sort((a, b) => a.date.localeCompare(b.date));

	return {
		summary: {
			purchaseCount,
			revenue,
			avgCheck,
			uniqueBuyers,
			viewCount,
			funnelPurchaseCount
		},
		brands: brandItems,
		categories: categoryItems,
		funnel: [
			{ stage: 'Просмотры (view)', count: viewCount, conversion: 100 },
			{
				stage: 'Покупки (purchase)',
				count: funnelPurchaseCount,
				conversion: funnelConversion
			}
		],
		dynamics,
		meta: {
			totalRows: rows.length,
			purchaseEventType: 'cart',
			funnelEventTypes: ['view', 'purchase']
		}
	};
}

function analyzeCsvText(csvText) {
	const parsed = parseCsvSemicolon(csvText);
	if (!parsed.ok) return parsed;
	const required = ['event_time', 'event_type', 'price'];
	for (const field of required) {
		if (!parsed.headers.includes(field)) {
			return { ok: false, error: `В CSV отсутствует обязательная колонка «${field}».` };
		}
	}
	const analytics = computeAnalyticsFromRows(parsed.rows);
	return { ok: true, analytics, rowCount: parsed.rows.length };
}
