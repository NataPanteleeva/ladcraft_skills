type JsonRecord = Record<string, unknown>;

function asRecord(value: unknown): JsonRecord | null {
	return value != null && typeof value === 'object' && !Array.isArray(value)
		? (value as JsonRecord)
		: null;
}

export function isPlaceholderToken(value: string | null | undefined): boolean {
	const token = typeof value === 'string' ? value.trim() : '';
	if (!token) return false;
	return /^(replace(?:[_-]?with)?[_-]?token|stub(?:[_-]?token)?|changeme|todo)$/i.test(token);
}

export function normalizeConfiguredToken(value: string | null | undefined): string {
	const token = typeof value === 'string' ? value.trim() : '';
	return token && !isPlaceholderToken(token) ? token : '';
}

export function unwrapApiEnvelope(payload: unknown): unknown {
	let current = payload;
	for (let depth = 0; depth < 3; depth += 1) {
		const record = asRecord(current);
		if (!record) return current;
		if (record.result !== undefined) {
			current = record.result;
			continue;
		}
		if (record.data !== undefined) {
			current = record.data;
			continue;
		}
		return current;
	}
	return current;
}

export function extractAccessToken(payload: unknown): string | null {
	const queue: unknown[] = [payload];
	const seen = new Set<unknown>();

	while (queue.length > 0) {
		const candidate = queue.shift();
		if (candidate == null || seen.has(candidate)) continue;
		seen.add(candidate);
		const record = asRecord(candidate);
		if (!record) continue;
		const accessToken = typeof record.access_token === 'string' ? record.access_token.trim() : '';
		if (accessToken) return accessToken;
		if (record.result !== undefined) queue.push(record.result);
		if (record.data !== undefined) queue.push(record.data);
	}

	return null;
}

export function extractRefreshToken(payload: unknown): string | null {
	const queue: unknown[] = [payload];
	const seen = new Set<unknown>();

	while (queue.length > 0) {
		const candidate = queue.shift();
		if (candidate == null || seen.has(candidate)) continue;
		seen.add(candidate);
		const record = asRecord(candidate);
		if (!record) continue;
		const refreshToken =
			typeof record.refresh_token === 'string' ? record.refresh_token.trim() : '';
		if (refreshToken) return refreshToken;
		if (record.result !== undefined) queue.push(record.result);
		if (record.data !== undefined) queue.push(record.data);
	}

	return null;
}

export function extractSkillsArray(payload: unknown): Array<Record<string, unknown>> {
	const direct = asRecord(payload);
	const directSkills = direct?.skills;
	if (Array.isArray(directSkills)) {
		return directSkills.filter((item): item is Record<string, unknown> => asRecord(item) != null);
	}

	const unwrapped = unwrapApiEnvelope(payload);
	if (Array.isArray(unwrapped)) {
		return unwrapped.filter((item): item is Record<string, unknown> => asRecord(item) != null);
	}

	const record = asRecord(unwrapped);
	if (Array.isArray(record?.skills)) {
		return record.skills.filter((item): item is Record<string, unknown> => asRecord(item) != null);
	}

	return [];
}

export function extractApiErrorMessage(payload: unknown, fallback: string): string {
	const normalizeText = (value: unknown): string | null => {
		if (typeof value !== 'string') return null;
		const text = value.trim();
		return text.length > 0 ? text : null;
	};

	const detailToMessage = (entry: unknown): string | null => {
		const detailRecord = asRecord(entry);
		if (!detailRecord) return normalizeText(entry);
		const base =
			normalizeText(detailRecord.message) ??
			normalizeText(detailRecord.msg) ??
			normalizeText(detailRecord.error) ??
			normalizeText(detailRecord.detail);
		if (!base) return null;
		const field =
			normalizeText(detailRecord.field) ??
			(Array.isArray(detailRecord.loc)
				? detailRecord.loc.map((x) => String(x)).filter(Boolean).join('.')
				: null);
		return field ? `${field}: ${base}` : base;
	};

	const collectDetails = (value: unknown, depth = 0): string[] => {
		if (depth > 4 || value == null) return [];
		if (Array.isArray(value)) {
			return value.flatMap((entry) => collectDetails(entry, depth + 1));
		}
		const record = asRecord(value);
		if (!record) {
			const text = normalizeText(value);
			return text ? [text] : [];
		}
		const currentDetail = detailToMessage(record);
		const nested = [
			...collectDetails(record.details, depth + 1),
			...collectDetails(record.errors, depth + 1),
			...collectDetails(record.data, depth + 1),
			...collectDetails(record.result, depth + 1)
		];
		return currentDetail ? [currentDetail, ...nested] : nested;
	};

	if (typeof payload === 'string' && payload.trim()) return payload.trim();
	const record = asRecord(payload);
	if (!record) return fallback;

	const details = Array.from(new Set(collectDetails(record.details)));
	for (const key of ['message', 'error', 'detail', 'raw']) {
		const value = normalizeText(record[key]);
		if (value) {
			const compactDetails = details.filter((item) => item !== value);
			return compactDetails.length > 0 ? `${value}: ${compactDetails.join('; ')}` : value;
		}
	}

	const nestedDetails = Array.from(
		new Set([
			...details,
			...collectDetails(record.errors),
			...collectDetails(record.data),
			...collectDetails(record.result)
		])
	);
	return nestedDetails.length > 0 ? `${fallback}: ${nestedDetails.join('; ')}` : fallback;
}
