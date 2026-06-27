async function handler(state, params) {
  const vfs = getVfs(state);
  if (!vfs) return { ok: false, error: 'vfs writeFile недоступен' };

  const rescueId = getString(params, 'rescue_id').trim();
  const incidentId = getString(params, 'incident_id').trim();
  const text = getString(params, 'text');
  const explicitPath = getString(params, 'path').trim();

  if (!text.trim()) return { ok: false, error: 'text пуст' };

  // Точный путь (path) от оркестратора приоритетнее реконструкции из rescue_id+incident_id:
  // это устраняет дрейф id, воркеру достаточно дословно скопировать одну строку path.
  let path = explicitPath;
  if (!path) {
    if (!rescueId || !incidentId) return { ok: false, error: 'нужен path, либо rescue_id и incident_id' };
    path = notePath(rescueId, incidentId);
  }
  await vfs.writeFile(path, text);

  return { ok: true, incident_id: incidentId, path: path, length: text.length };
}
