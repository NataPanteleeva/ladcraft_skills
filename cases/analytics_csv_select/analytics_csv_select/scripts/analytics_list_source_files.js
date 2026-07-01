async function handler(state, params) {
	const raw = params && typeof params === 'object' ? params : {};
	const folderName =
		typeof raw.folder_name === 'string' && raw.folder_name.trim()
			? raw.folder_name.trim()
			: defaultFolderName(state);
	const fileExtension =
		typeof raw.file_extension === 'string' && raw.file_extension.trim()
			? normalizeExtension(raw.file_extension)
			: '.csv';
	const explicitDirectoryId = parsePositiveId(raw.directory_id);
	const useCurrentDocument =
		raw.use_current_document === true ||
		raw.use_current_document === 'true' ||
		raw.use_current_document === 1 ||
		raw.use_current_document === '1';

	const auth = await ensureDiskAuth(state, raw);
	if (!auth.ok) {
		return {
			ok: false,
			error: auth.error || 'Ошибка авторизации Р7 Диск.',
			agent_message: auth.error || 'Не удалось подключиться к Р7 Диску.'
		};
	}

	if (useCurrentDocument) {
		return resolveCurrentDocumentSource(
			auth,
			raw.document_id,
			raw.file_name,
			fileExtension
		);
	}

	// При fallback пересчитываем корень «Мои документы» от открытого документа.
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
			return {
				ok: false,
				error: rootList.error || 'Не удалось получить список папок.',
				agent_message: rootList.error || 'Не удалось получить список папок.'
			};
		}
		const folders = normalizeFolderList(rootList.entry).sort(function (a, b) {
			return String(a.name).localeCompare(String(b.name), 'ru');
		});
		return {
			ok: true,
			folder_found: false,
			folder_name: folderName,
			my_documents_directory_id: auth.myDocumentsDirectoryId,
			folders: folders,
			files: [],
			source: 'fallback_root_list',
			do_not_invent_content: true,
			cite_only_fields: ['folders', 'files'],
			agent_message: `Папка «${folderName}» не найдена. Выберите папку из списка.`
		};
	}

	const listing = await fetchDirectoryEntry(auth.baseUrl, auth.authToken, directoryId);
	if (!listing.ok) {
		return {
			ok: false,
			error: listing.error || 'Не удалось получить содержимое папки.',
			agent_message: listing.error || 'Не удалось получить содержимое папки.'
		};
	}
	const entry = listing.entry || {};
	const directoryName = pickString(entry.Title, entry.Name) || `directory_${directoryId}`;
	const files = normalizeCsvList(entry, fileExtension);
	if (files.length > 0) {
		for (let i = 0; i < files.length; i += 1) {
			if (files[i].directory_id == null) files[i].directory_id = directoryId;
		}
	}

	return {
		ok: true,
		folder_found: true,
		folder_name: folderName,
		directory_id: directoryId,
		directory_name: directoryName,
		my_documents_directory_id: auth.myDocumentsDirectoryId,
		file_extension: fileExtension,
		files: files,
		folders: [],
		source: source,
		do_not_invent_content: true,
		cite_only_fields: ['files', 'folders'],
		agent_message:
			files.length > 0
				? `Найдено CSV-файлов: ${files.length}. Выберите номер или имя файла.`
				: `В папке «${directoryName}» нет файлов ${fileExtension}.`
	};
}

function defaultFolderName(state) {
	const userEnv = readUserEnv(state);
	const envName =
		userEnv && typeof userEnv.ANALYTICS_REPORT_FOLDER_NAME === 'string'
			? userEnv.ANALYTICS_REPORT_FOLDER_NAME.trim()
			: '';
	return envName || 'Таблицы для отчета';
}

function normalizeExtension(value) {
	const ext = String(value || '').trim().toLowerCase();
	if (!ext) return '.csv';
	return ext.startsWith('.') ? ext : `.${ext}`;
}
