async function handler(state, params) {
  const sql = getSqlStorage(state);
  if (!sql) return { ok: false, error: 'sql-storage get/runSQL недоступен' };

  const rescueId = getString(params, 'rescue_id').trim();
  const incidentId = getString(params, 'incident_id').trim();
  const verdict = getString(params, 'verdict').trim() || 'needs_review';
  const severity = getString(params, 'severity').trim() || 'medium';
  const advice = getString(params, 'advice').trim();

  if (!rescueId || !incidentId) return { ok: false, error: 'rescue_id и incident_id обязательны' };

  const storageId = await sqlStorageId(sql);
  if (!storageId) return { ok: false, error: 'SQL storage не инициализирована для этого пользователя' };
  await ensureSchema(sql, storageId);

  await sql.runSQL(
    storageId,
    "INSERT INTO diagnoses (rescue_id, incident_id, verdict, severity, advice) VALUES ('" +
      sqlEsc(rescueId) + "','" + sqlEsc(incidentId) + "','" + sqlEsc(verdict) + "','" +
      sqlEsc(severity) + "','" + sqlEsc(advice) + "')"
  );

  await sql.runSQL(
    storageId,
    "UPDATE incidents SET status='triaged', severity='" + sqlEsc(severity) + "', updated_at=NOW() WHERE rescue_id='" +
      sqlEsc(rescueId) + "' AND incident_id='" + sqlEsc(incidentId) + "'"
  );

  return { ok: true, rescue_id: rescueId, incident_id: incidentId, verdict: verdict, severity: severity };
}
