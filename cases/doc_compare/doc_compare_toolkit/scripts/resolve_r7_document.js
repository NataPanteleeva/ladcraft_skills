async function handler(state, params) {
  const vfs = getVfs(state);
  if (!vfs) {
    return { ok: false, error: 'VFS недоступен', found: false, session_file: '', attempts: 0 };
  }

  const sessionFileHint = normalizeSessionFilePath(getString(params, 'session_file'));
  const docKey = getString(params, 'doc_key').trim();
  let retries = getNumber(params, 'retries');
  let waitMs = getNumber(params, 'wait_ms');
  if (!retries || retries < 1) retries = 3;
  if (retries > 8) retries = 8;
  if (!waitMs || waitMs < 0) waitMs = 2000;
  if (waitMs > 10000) waitMs = 10000;

  const candidates = [];
  if (sessionFileHint) candidates.push(sessionFileHint);
  if (docKey) {
    const fromKey = r7SnapshotPathFromDocKey(docKey);
    if (fromKey && candidates.indexOf(fromKey) === -1) candidates.push(fromKey);
  }

  let attempts = 0;
  let lastReason = 'not_found';

  for (let round = 0; round < retries; round++) {
    attempts = round + 1;

    for (let c = 0; c < candidates.length; c++) {
      const path = candidates[c];
      const status = await vfsSnapshotReady(vfs, path);
      if (status.ready) {
        return {
          ok: true,
          found: true,
          session_file: path,
          doc_key: docKey,
          attempts: attempts,
          source: sessionFileHint === path ? 'session_file' : 'doc_key',
          reason: 'ready',
          body_length: status.body_length
        };
      }
      lastReason = status.reason || 'not_found';
    }

    const scanned = await scanR7SessionFiles(vfs);
    for (let i = 0; i < scanned.length; i++) {
      const item = scanned[i];
      if (item.kind === 'r7_snapshot' || item.path.indexOf('/session/r7/') !== -1) {
        const status = await vfsSnapshotReady(vfs, item.path);
        if (status.ready) {
          return {
            ok: true,
            found: true,
            session_file: item.path,
            doc_key: docKey,
            attempts: attempts,
            source: 'scan',
            reason: 'ready',
            body_length: status.body_length,
            files: scanned
          };
        }
        lastReason = status.reason || 'empty_body';
      }
    }

    if (round < retries - 1) {
      await sleepMs(waitMs);
    }
  }

  const lastScan = await scanR7SessionFiles(vfs);
  return {
    ok: true,
    found: false,
    session_file: candidates.length ? candidates[0] : '',
    doc_key: docKey,
    attempts: attempts,
    reason: lastReason,
    candidates: candidates,
    files: lastScan,
    hint: 'Повторите resolve_r7_document через несколько секунд или дождитесь завершения upload плагина.'
  };
}
