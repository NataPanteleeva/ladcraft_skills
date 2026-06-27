async function handler(state, params) {
  const sql = getSqlStorage(state);
  if (!sql) return { ok: false, error: 'sql-storage get/runSQL недоступен' };

  const rescueId = getString(params, 'rescue_id').trim();
  if (!rescueId) return { ok: false, error: 'rescue_id обязателен' };

  const storageId = await sqlStorageId(sql);
  if (!storageId) return { ok: false, error: 'SQL storage не инициализирована для этого пользователя' };
  await ensureSchema(sql, storageId);

  const sessionRes = await sql.runSQL(
    storageId,
    "SELECT id, dev_name, vibe, fatigue, caffeine, status FROM rescue_session WHERE id='" + sqlEsc(rescueId) + "'"
  );
  const incidentsRes = await sql.runSQL(
    storageId,
    "SELECT incident_id, kind, title, ord, severity, status, note_path FROM incidents WHERE rescue_id='" +
      sqlEsc(rescueId) + "' ORDER BY ord"
  );
  const diagnosesRes = await sql.runSQL(
    storageId,
    "SELECT incident_id, verdict, severity, advice FROM diagnoses WHERE rescue_id='" + sqlEsc(rescueId) + "' ORDER BY id"
  );

  const sessionRows = extractRows(sessionRes);
  return {
    ok: true,
    rescue_id: rescueId,
    session: sessionRows.length ? sessionRows[0] : null,
    incidents: extractRows(incidentsRes),
    diagnoses: extractRows(diagnosesRes)
  };
}
