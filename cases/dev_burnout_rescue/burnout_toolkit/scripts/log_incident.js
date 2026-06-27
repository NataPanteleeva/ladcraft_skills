async function handler(state, params) {
  const sql = getSqlStorage(state);
  if (!sql) return { ok: false, error: 'sql-storage get/runSQL недоступен' };

  const rescueId = getString(params, 'rescue_id').trim();
  const incidentId = (getString(params, 'incident_id').trim() || slug(getString(params, 'title')));
  const kind = getString(params, 'kind').trim() || 'misc';
  const title = getString(params, 'title').trim() || incidentId;
  const ord = getNumber(params, 'ord');

  if (!rescueId) return { ok: false, error: 'rescue_id обязателен' };
  if (!incidentId) return { ok: false, error: 'нужен incident_id или title' };

  const storageId = await sqlStorageId(sql);
  if (!storageId) return { ok: false, error: 'SQL storage не инициализирована для этого пользователя' };
  await ensureSchema(sql, storageId);

  const np = notePath(rescueId, incidentId);
  await sql.runSQL(
    storageId,
    "INSERT INTO incidents (rescue_id, incident_id, kind, title, ord, status, note_path) VALUES ('" +
      sqlEsc(rescueId) + "','" + sqlEsc(incidentId) + "','" + sqlEsc(kind) + "','" + sqlEsc(title) + "'," +
      (ord || 0) + ",'open','" + sqlEsc(np) + "')"
  );

  return { ok: true, rescue_id: rescueId, incident_id: incidentId, kind: kind, title: title, note_path: np };
}
