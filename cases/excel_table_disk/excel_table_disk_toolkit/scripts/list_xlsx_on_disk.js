async function handler(state, params) {
	const raw = params && typeof params === 'object' ? params : {};
	const folderName =
		typeof raw.folder_name === 'string' && raw.folder_name.trim()
			? raw.folder_name.trim()
			: 'Таблицы для сверки';
	const fileExtension =
		typeof raw.file_extension === 'string' && raw.file_extension.trim()
			? normalizeExtension(raw.file_extension)
			: '.xlsx';
	const explicitDirectoryId = parsePositiveId(raw.directory_id);
	const useCurrentDocument =
		raw.use_current_document === true ||
		raw.use_current_document === 'true' ||
		raw.use_current_document === 1 ||
		raw.use_current_document === '1';
	const listRoot =
		raw.list_root === true || raw.list_root === 'true' || raw.list_root === 1;

	const auth = await ensureDiskAuth(state, raw, { deferMyDocuments: useCurrentDocument });
	if (!auth.ok) {
		return {
			ok: false,
			error: auth.error || 'Ошибка авторизации Р7 Диск.',
			agent_message: auth.error || 'Не удалось подключиться к Р7 Диску.'
		};
	}

	if (useCurrentDocument) {
		const resolved = await resolveCurrentDocumentSource(
			auth,
			raw.document_id,
			raw.file_name,
			fileExtension,
			folderName
		);
		if (resolved && resolved.ok) {
			resolved.current_file_is_xlsx = !!resolved.current_file_is_csv;
			resolved.agent_message = resolved.current_file_is_xlsx
				? 'Текущий документ — Excel. Можно использовать как источник A или построить отчёт по нему.'
				: resolved.agent_message || 'Текущий файл не .xlsx — выберите другой с диска.';
		}
		return resolved;
	}

	if (parsePositiveId(raw.document_id) != null) {
		const hostRoot = await resolveMyDocumentsRootFromHostDocument(
			auth.baseUrl,
			auth.authToken,
			raw.document_id
		);
		if (hostRoot != null && hostRoot.directory_id != null) {
			auth.myDocumentsDirectoryId = hostRoot.directory_id;
			if (auth.skillStorage) {
				auth.skillStorage.set(STORAGE_KEY_MY_DOCS, String(hostRoot.directory_id));
			}
		}
	}

	if (listRoot || explicitDirectoryId == null && !folderName) {
		const rootList = await fetchDirectoryEntry(
			auth.baseUrl,
			auth.authToken,
			auth.myDocumentsDirectoryId
		);
		if (!rootList.ok) {
			return { ok: false, error: rootList.error, agent_message: rootList.error };
		}
		const folders = normalizeFolderList(rootList.entry).sort(function (a, b) {
			return String(a.name).localeCompare(String(b.name), 'ru');
		});
		const files = normalizeCsvList(rootList.entry, fileExtension);
		return {
			ok: true,
			folder_found: true,
			directory_id: auth.myDocumentsDirectoryId,
			folders: folders,
			files: files,
			agent_message: 'Корень «Мои документы»: выберите папку или .xlsx файл.'
		};
	}

	let directoryId = explicitDirectoryId;
	let folderFound = true;
	let source = explicitDirectoryId != null ? 'explicit_directory_id' : 'search_by_folder_name';
	if (directoryId == null) {
		directoryId = await findFolderByNameInsensitive(
			auth.baseUrl,
			auth.authToken,
			auth.myDocumentsDirectoryId,
			folderName,
			4
		);
		if (directoryId == null) {
			folderFound = false;
		}
	}

	if (!folderFound) {
		const rootList = await fetchDirectoryEntry(
			auth.baseUrl,
			auth.authToken,
			auth.myDocumentsDirectoryId
		);
		if (!rootList.ok) {
			return { ok: false, error: rootList.error, agent_message: rootList.error };
		}
		const folders = normalizeFolderList(rootList.entry).sort(function (a, b) {
			return String(a.name).localeCompare(String(b.name), 'ru');
		});
		return {
			ok: true,
			folder_found: false,
			folder_name: folderName,
			folders: folders,
			files: [],
			agent_message: 'Папка «' + folderName + '» не найдена. Выберите папку из списка.'
		};
	}

	const listing = await fetchDirectoryEntry(auth.baseUrl, auth.authToken, directoryId);
	if (!listing.ok) {
		return { ok: false, error: listing.error, agent_message: listing.error };
	}
	const entry = listing.entry || {};
	const directoryName = pickString(entry.Title, entry.Name) || 'directory_' + directoryId;
	const files = normalizeCsvList(entry, fileExtension);
	const folders = normalizeFolderList(entry);
	for (let i = 0; i < files.length; i += 1) {
		if (files[i].directory_id == null) files[i].directory_id = directoryId;
	}
	return {
		ok: true,
		folder_found: true,
		folder_name: folderName,
		directory_id: directoryId,
		directory_name: directoryName,
		files: files,
		folders: folders,
		source: source,
		agent_message:
			files.length > 0
				? 'Найдено Excel-файлов: ' + files.length + '. Укажите id или имя.'
				: 'В папке нет .xlsx. Можно открыть подпапку (directory_id).'
	};
}

function normalizeExtension(value) {
	const ext = String(value || '').trim().toLowerCase();
	if (!ext) return '.xlsx';
	return ext.startsWith('.') ? ext : '.' + ext;
}
