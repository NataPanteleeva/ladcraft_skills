async function handler(state, params) {
  const sql = getSqlStorage(state);
  const vfs = getVfs(state);
  if (!sql) return { ok: false, error: 'sql-storage get/runSQL недоступен' };
  if (!vfs || typeof vfs.readFile !== 'function') return { ok: false, error: 'vfs readFile недоступен' };

  const rescueId = getString(params, 'rescue_id').trim();
  if (!rescueId) return { ok: false, error: 'rescue_id обязателен' };

  const storageId = await sqlStorageId(sql);
  if (!storageId) return { ok: false, error: 'SQL storage не инициализирована для этого пользователя' };
  await ensureSchema(sql, storageId);

  const incidentsRes = await sql.runSQL(
    storageId,
    "SELECT incident_id, ord, note_path FROM incidents WHERE rescue_id='" + sqlEsc(rescueId) + "' ORDER BY ord"
  );
  const rows = extractRows(incidentsRes);

  const present = [];
  const missing = [];
  for (let i = 0; i < rows.length; i++) {
    const incidentId = getString(rows[i], 'incident_id').trim();
    if (!incidentId) continue;
    const np = getString(rows[i], 'note_path').trim() || notePath(rescueId, incidentId);
    let body = '';
    try { body = await vfs.readFile(np); } catch (e) { body = ''; }
    if (typeof body === 'string' && body.trim()) present.push(incidentId);
    else missing.push(incidentId);
  }

  return {
    ok: true,
    rescue_id: rescueId,
    total: present.length + missing.length,
    present: present,
    missing: missing,
    complete: missing.length === 0
  };
}
