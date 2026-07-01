async function handler(state, params) {
	const warnings = [];
	const userEnv = readUserEnv(state);
	const skillStorage = resolveSkillStorage(state);
	const baseUrl = resolveBaseUrl(state, params, skillStorage);
	const login = pickString(params?.login, userEnv.R7_DISK_LOGIN);
	const password = pickString(params?.password, userEnv.R7_DISK_PASSWORD);

	if (!baseUrl) {
		return fail('Не задан R7_DISK_BASE_URL.', warnings);
	}

	const directoryId = resolvePositiveId(
		params?.directory_id ?? userEnv.ANALYTICS_CSV_DIRECTORY_ID ?? 109
	);
	const csvName = pickString(
		params?.csv_name,
		userEnv.ANALYTICS_CSV_DEFAULT_INPUT_NAME || 'data_first_1000.csv'
	);
	const outputNameRaw = pickString(params?.output_name, buildDefaultOutputName());
	const outputName = ensureXlsxExtension(outputNameRaw);
	const conflictPolicy = pickString(params?.conflict_policy, 'suffix').toLowerCase();

	if (directoryId == null) {
		return fail('Не задан directory_id (или ANALYTICS_CSV_DIRECTORY_ID).', warnings);
	}
	if (!csvName) {
		return fail('Не задан csv_name.', warnings);
	}

	const authResult = await ensureAuthToken(
		baseUrl,
		login,
		password,
		skillStorage,
		params?.auth_token
	);
	if (!authResult.ok) {
		return fail(authResult.error, warnings);
	}
	const authToken = authResult.auth_token;

	const csvLookup = await getDocumentIdByName(baseUrl, authToken, directoryId, csvName);
	if (!csvLookup.ok || csvLookup.documentId == null) {
		return fail(
			`CSV «${csvName}» не найден в папке directory_id=${directoryId}.`,
			warnings
		);
	}

	const csvDownloaded = await downloadDocumentBytes(baseUrl, authToken, csvLookup.documentId);
	if (!csvDownloaded.ok) {
		return fail(`Не удалось скачать CSV: ${csvDownloaded.error}`, warnings);
	}

	const csvText = decodeUtf8(csvDownloaded.bytes);
	const analyzed = analyzeCsvText(csvText);
	if (!analyzed.ok) {
		return fail(analyzed.error, warnings);
	}

	let outputBytes;
	try {
		outputBytes = buildSalesReportXlsx(analyzed.analytics);
	} catch (err) {
		return fail(`Не удалось собрать XLSX: ${errorMessage(err)}`, warnings);
	}

	const finalNameResult = await resolveOutputNameByPolicy(
		baseUrl,
		authToken,
		directoryId,
		outputName,
		conflictPolicy
	);
	if (!finalNameResult.ok) {
		return fail(finalNameResult.error, warnings);
	}

	const uploaded = await performMultipartUpload(
		baseUrl,
		authToken,
		directoryId,
		finalNameResult.name,
		outputBytes,
		'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
	);
	if (!uploaded.ok) {
		return fail(`Не удалось загрузить отчёт: ${uploaded.error}`, warnings);
	}

	const summary = analyzed.analytics.summary;
	const sheets = listReportSheets(analyzed.analytics);
	warnings.push(
		'Покупки для сводки/брендов/категорий/динамики: event_type=cart. Воронка: view → purchase.'
	);

	return {
		ok: true,
		operation: 'analytics_csv_generate_report',
		base_url: baseUrl,
		directory_id: directoryId,
		csv_name: csvName,
		csv_document_id: csvLookup.documentId,
		csv_rows: analyzed.rowCount,
		output_name: finalNameResult.name,
		output_document_id: uploaded.document_id,
		output_size_bytes: outputBytes.length,
		summary: {
			purchaseCount: summary.purchaseCount,
			revenue: summary.revenue,
			avgCheck: summary.avgCheck,
			uniqueBuyers: summary.uniqueBuyers,
			viewCount: summary.viewCount,
			funnelPurchaseCount: summary.funnelPurchaseCount
		},
		sheets,
		warnings,
		do_not_retry: true,
		agent_stop: true,
		forbid_followup_tools: ['analytics_csv_generate_report'],
		agent_message:
			`Отчёт «${finalNameResult.name}» создан в папке id=${directoryId}. ` +
			`Покупок (cart): ${summary.purchaseCount}, выручка: ${summary.revenue} руб. ` +
			'Откройте файл в редакторе таблиц Р7 Офис — 5 листов с таблицами и графиками.'
	};
}

function fail(message, warnings) {
	return {
		ok: false,
		operation: 'analytics_csv_generate_report',
		error: message,
		warnings: warnings.concat([message]),
		summary: null,
		sheets: []
	};
}
