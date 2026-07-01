async function handler(state, params) {
	const auth = await ensureDiskAuth(state);
	if (!auth.ok) return auth;

	const dirResult = await resolveTemplatesDirectory(state, params, auth);
	if (!dirResult.ok) return dirResult;
	const templatesDirectoryId = dirResult.directory_id;

	const raw = params && typeof params === 'object' ? params : {};
	const templateName = pickString(raw.template_name);
	const documentIdParam = parsePositiveId(raw.document_id);
	if (!templateName && documentIdParam == null) {
		return { ok: false, error: 'Нужен template_name или document_id.' };
	}

	let documentId = documentIdParam;
	let fileName = templateName;
	if (documentId == null) {
		const lookup = await findDocumentInDirectory(
			auth.baseUrl,
			auth.authToken,
			templatesDirectoryId,
			templateName
		);
		if (!lookup.ok) return lookup;
		documentId = lookup.document_id;
		fileName = lookup.file_name;
	}

	return fetchDocumentText(
		auth.baseUrl,
		auth.authToken,
		documentId,
		fileName,
		TEMPLATE_MAX_BYTES
	);
}
