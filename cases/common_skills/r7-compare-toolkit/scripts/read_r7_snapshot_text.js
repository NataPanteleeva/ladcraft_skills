async function handler(state, params) {
  const vfs = getVfs(state);
  if (!vfs) {
    return {
      ok: false,
      error: 'VFS недоступен',
      reason: 'not_found',
      session_file: '',
      text: ''
    };
  }

  const sessionFile = normalizeSessionFilePath(getString(params, 'session_file'));
  if (!sessionFile) {
    return {
      ok: false,
      error: 'session_file обязателен',
      reason: 'not_found',
      session_file: '',
      text: ''
    };
  }

  let limitChars = getNumber(params, 'limit_chars');
  if (!limitChars || limitChars < 1) limitChars = 80000;
  if (limitChars > 300000) limitChars = 300000;

  const probe = await readR7SnapshotOriginal(vfs, sessionFile);
  if (!probe.ok) {
    return {
      ok: false,
      error: 'Snapshot не готов: ' + probe.reason,
      reason: probe.reason,
      session_file: sessionFile,
      schema: probe.schema || '',
      body_length: typeof probe.body_length === 'number' ? probe.body_length : 0,
      text: ''
    };
  }

  const fullText = probe.body_text || '';
  const text = fullText.slice(0, limitChars);

  return {
    ok: true,
    reason: 'ready',
    session_file: sessionFile,
    schema: probe.schema || 'r7-snapshot/v1',
    body_length: fullText.length,
    bytes_read: typeof probe.raw === 'string' ? probe.raw.length : 0,
    truncated: fullText.length > limitChars,
    limit_chars: limitChars,
    text: text
  };
}
