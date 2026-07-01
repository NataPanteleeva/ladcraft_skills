async function handler(state, params) {
	const auth = await ensureDiskAuth(state);
	if (!auth.ok) return auth;

	const raw = params && typeof params === 'object' ? params : {};
	return fetchHostDocumentText(state, raw, auth, DOCUMENT_MAX_BYTES);
}
