async function handler(state, params) {
  const sql = getSqlStorage(state);
  const vfs = getVfs(state);
  if (!sql) return { ok: false, error: 'sql-storage get/runSQL недоступен' };
  if (!vfs || typeof vfs.readFile !== 'function') return { ok: false, error: 'vfs readFile/writeFile недоступен' };

  const rescueId = getString(params, 'rescue_id').trim();
  const header = getString(params, 'header');
  const pepTalk = getString(params, 'pep_talk_text');
  if (!rescueId) return { ok: false, error: 'rescue_id обязателен' };

  const storageId = await sqlStorageId(sql);
  if (!storageId) return { ok: false, error: 'SQL storage не инициализирована для этого пользователя' };
  await ensureSchema(sql, storageId);

  let incidents = getArray(params, 'incidents');
  if (!incidents.length) {
    const incidentsRes = await sql.runSQL(
      storageId,
      "SELECT incident_id, title, ord, note_path FROM incidents WHERE rescue_id='" +
        sqlEsc(rescueId) + "' ORDER BY ord"
    );
    incidents = extractRows(incidentsRes);
  }
  if (!incidents.length) return { ok: false, error: 'нет инцидентов для сборки (пустой журнал и пустой incidents)' };

  const parts = [];
  if (header.trim()) parts.push(header.trim());
  else parts.push('# План спасения разработчика');

  const missing = [];
  for (let i = 0; i < incidents.length; i++) {
    const incidentId = getString(incidents[i], 'incident_id').trim();
    if (!incidentId) continue;
    const np = getString(incidents[i], 'note_path').trim() || notePath(rescueId, incidentId);
    let body = '';
    try {
      body = await vfs.readFile(np);
    } catch (e) {
      body = '';
    }
    if (typeof body === 'string' && body.trim()) {
      parts.push(body.trim());
    } else {
      missing.push(incidentId);
      const title = getString(incidents[i], 'title').trim() || incidentId;
      parts.push('## ' + title + '\n\n_[разбор инцидента отсутствует: ' + incidentId + ']_');
    }
  }

  const documentText = parts.join('\n\n');
  const documentPath = outDir(rescueId) + '/rescue_plan.md';
  await vfs.writeFile(documentPath, documentText);

  let pepPath = '';
  if (pepTalk.trim()) {
    pepPath = outDir(rescueId) + '/pep_talk.md';
    await vfs.writeFile(pepPath, pepTalk.trim());
  }

  return {
    ok: true,
    rescue_id: rescueId,
    document_path: documentPath,
    pep_talk_path: pepPath,
    incidents_used: incidents.length,
    missing_incidents: missing
  };
}
