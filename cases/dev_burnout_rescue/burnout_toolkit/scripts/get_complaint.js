async function handler(state, params) {
  const vfs = getVfs(state);
  if (!vfs || typeof vfs.readFile !== 'function') return { ok: false, error: 'vfs readFile недоступен' };

  const rescueId = getString(params, 'rescue_id').trim();
  if (!rescueId) return { ok: false, error: 'rescue_id обязателен' };

  const p = complaintPath(rescueId);
  let raw = '';
  try {
    raw = await vfs.readFile(p);
  } catch (e) {
    return { ok: false, error: 'complaint.json не найден для ' + rescueId, complaint_path: p };
  }
  if (typeof raw !== 'string' || !raw.trim()) {
    return { ok: false, error: 'complaint.json пуст', complaint_path: p };
  }
  let complaint = null;
  try { complaint = JSON.parse(raw); } catch (e) { complaint = null; }
  return { ok: true, rescue_id: rescueId, complaint_path: p, complaint: complaint, raw: complaint ? '' : raw };
}
