async function handler(state, params) {
	const tableName =
		typeof params?.table_name === 'string' && params.table_name.trim()
			? params.table_name.trim()
			: 'demo_items';

	const rawSql = state.capabilities?.['sql-storage'];
	const canRun =
		rawSql &&
		typeof rawSql === 'object' &&
		typeof rawSql.get === 'function' &&
		typeof rawSql.runSQL === 'function';

	if (!canRun) {
		return { ok: false, error: 'sql-storage get/runSQL недоступен' };
	}

	const storageResponse = await rawSql.get();
	const storageId =
		storageResponse &&
		typeof storageResponse === 'object' &&
		storageResponse.result &&
		typeof storageResponse.result === 'object' &&
		typeof storageResponse.result.storage_id === 'string'
			? storageResponse.result.storage_id
			: '';

	if (!storageId) {
		return { ok: false, error: 'SQL storage не инициализирована для этого агента' };
	}

	const safeTable = tableName.replace(/[^a-zA-Z0-9_]/g, '_');

	await rawSql.runSQL(
		storageId,
		`CREATE TABLE IF NOT EXISTS ${safeTable} (
  id SERIAL PRIMARY KEY,
  title TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
)`
	);

	const insertResult = await rawSql.runSQL(
		storageId,
		`INSERT INTO ${safeTable} (title) VALUES ('seed row') RETURNING id`
	);

	return {
		ok: true,
		tableName: safeTable,
		storageId,
		insertResult
	};
}
