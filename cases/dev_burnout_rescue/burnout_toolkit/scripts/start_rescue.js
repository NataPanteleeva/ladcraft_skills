async function handler(state, params) {
  const sql = getSqlStorage(state);
  if (!sql) return { ok: false, error: 'sql-storage get/runSQL недоступен' };
  const vfs = getVfs(state);

  const devName = getString(params, 'dev_name').trim() || 'аноним';
  const vibe = getString(params, 'vibe').trim();
  const fatigue = clampInt(getNumber(params, 'fatigue'), 0, 100);
  const caffeine = clampInt(getNumber(params, 'caffeine'), 0, 100);
  const complaint = asObject(params) ? asObject(params.complaint) : null;
  const incidents = getArray(params, 'incidents');

  if (!incidents.length) return { ok: false, error: 'incidents не должен быть пустым' };

  const storageId = await sqlStorageId(sql);
  if (!storageId) return { ok: false, error: 'SQL storage не инициализирована для этого пользователя' };
  await ensureSchema(sql, storageId);

  const rescueId = genId('rsc');

  let complaintStored = '';
  if (complaint && vfs && typeof vfs.writeFile === 'function') {
    complaintStored = complaintPath(rescueId);
    try {
      await vfs.writeFile(complaintStored, JSON.stringify(complaint, null, 2));
    } catch (e) {
      complaintStored = '';
    }
  }

  await sql.runSQL(
    storageId,
    "INSERT INTO rescue_session (id, dev_name, vibe, fatigue, caffeine, status) VALUES ('" +
      sqlEsc(rescueId) + "','" + sqlEsc(devName) + "','" + sqlEsc(vibe) + "'," + fatigue + "," + caffeine + ",'open')"
  );

  const registered = [];
  let autoOrd = 0;
  for (let i = 0; i < incidents.length; i++) {
    const incidentId = (getString(incidents[i], 'incident_id').trim() || slug(getString(incidents[i], 'title')));
    if (!incidentId) continue;
    autoOrd += 1;
    const ord = getNumber(incidents[i], 'ord') || autoOrd;
    const kind = getString(incidents[i], 'kind').trim() || 'misc';
    const title = getString(incidents[i], 'title').trim() || incidentId;
    const np = notePath(rescueId, incidentId);
    await sql.runSQL(
      storageId,
      "INSERT INTO incidents (rescue_id, incident_id, kind, title, ord, status, note_path) VALUES ('" +
        sqlEsc(rescueId) + "','" + sqlEsc(incidentId) + "','" + sqlEsc(kind) + "','" + sqlEsc(title) + "'," +
        ord + ",'open','" + sqlEsc(np) + "')"
    );
    registered.push({ incident_id: incidentId, kind: kind, title: title, ord: ord, status: 'open', note_path: np });
  }

  registered.sort(function (a, b) { return a.ord - b.ord; });
  return {
    ok: true,
    rescue_id: rescueId,
    dev_name: devName,
    fatigue: fatigue,
    caffeine: caffeine,
    complaint_path: complaintStored,
    incidents: registered
  };
}
