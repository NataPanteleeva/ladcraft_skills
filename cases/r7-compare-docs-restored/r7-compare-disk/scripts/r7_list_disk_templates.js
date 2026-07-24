async function handler(state, params) {
	const auth = await ensureDiskAuth(state);
	if (!auth.ok) return auth;

	const raw = params && typeof params === 'object' ? params : {};
	const hostResult = await resolveHostDocument(state, raw, auth);
	if (!hostResult.ok) return hostResult;

	const listParams = {
		host_document_id: hostResult.document_id,
		directory_id: raw.directory_id
	};
	const dirResult = await resolveTemplatesDirectory(state, listParams, auth);
	if (!dirResult.ok) return dirResult;
	const templatesDirectoryId = dirResult.directory_id;

	const nav = await prepareCompareResultsFromTemplatesDir(
		auth.baseUrl,
		auth.authToken,
		templatesDirectoryId,
		auth.skillStorage,
		dirResult.my_documents_directory_id
	);
	if (!nav.ok) {
		return {
			ok: false,
			error: nav.error,
			agent_message: nav.error
		};
	}

	const docs = await fetchDirectoryDocuments(auth.baseUrl, auth.authToken, templatesDirectoryId);
	const templates = [];
	for (let i = 0; i < docs.length; i += 1) {
		const doc = docs[i];
		const name = typeof doc.Name === 'string' ? doc.Name.trim() : '';
		if (!name || !isTemplateFileName(name)) continue;
		const documentId = typeof doc.Id === 'number' ? doc.Id : null;
		if (documentId == null) continue;
		const sizeBytes = typeof doc.Size === 'number' ? doc.Size : 0;
		templates.push({
			name: name,
			size_kb: bytesToKb(sizeBytes),
			document_id: documentId
		});
	}
	templates.sort(function (a, b) {
		return String(a.name).localeCompare(String(b.name), 'ru');
	});

	const skillStorage = auth.skillStorage || resolveSkillStorage(state);
	if (skillStorage) {
		saveTemplateDocumentIds(skillStorage, templates);
	}

	return {
		ok: true,
		templates: templates,
		host_document_id: hostResult.document_id,
		host_file_name: hostResult.file_name,
		host_resolved_via: hostResult.resolved_via,
		directory_id: templatesDirectoryId,
		my_documents_directory_id: nav.my_documents_directory_id,
		compare_results_folder_id: nav.compare_results_folder_id,
		source: 'r7-disk',
		agent_message:
			templates.length > 0
				? 'Хост-документ: «' +
					hostResult.file_name +
					'» (id=' +
					hostResult.document_id +
					'). Шаблонов: ' +
					templates.length +
					'.'
				: 'В папке templates нет файлов .md или .docx.'
	};
}
