export function extractRemoteErrorPayload(data: unknown): { error?: string; details?: unknown } {
	if (!data || typeof data !== 'object') {
		return {};
	}
	const record = data as Record<string, unknown>;
	if (typeof record.error === 'string') {
		return { error: record.error, details: record.details };
	}
	if (record.data && typeof record.data === 'object') {
		return extractRemoteErrorPayload(record.data);
	}
	if (typeof record.raw === 'string' && record.raw.trim()) {
		return { error: record.raw.trim() };
	}
	return {};
}
