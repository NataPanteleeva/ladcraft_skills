async function handler(state, params) {
	const auth = await ensureDiskAuth(state);
	if (!auth.ok) return auth;

	const raw = params && typeof params === 'object' ? params : {};
	const documentId = parsePositiveId(raw.document_id);
	if (documentId == null) {
		return { ok: false, error: 'Поле document_id обязательно (число).' };
	}
	const fileName = pickString(raw.file_name) || 'document.docx';

	return fetchDocumentText(
		auth.baseUrl,
		auth.authToken,
		documentId,
		fileName,
		DOCUMENT_MAX_BYTES
	);
}
