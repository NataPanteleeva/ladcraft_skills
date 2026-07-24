async function handler(state, params) {
  const vfs = getVfs(state);
  if (!vfs) {
    return { ok: false, error: 'VFS недоступен', files: [], count: 0 };
  }

  let retries = getNumber(params, 'retries');
  let waitMs = getNumber(params, 'wait_ms');
  if (!retries || retries < 1) retries = 1;
  if (retries > 8) retries = 8;
  if (!waitMs || waitMs < 0) waitMs = 0;
  if (waitMs > 10000) waitMs = 10000;

  let files = [];
  for (let round = 0; round < retries; round++) {
    const scanned = await scanR7SessionFiles(vfs);
    files = [];
    for (let i = 0; i < scanned.length; i++) {
      const item = scanned[i];
      const status = await vfsSnapshotReady(vfs, item.path);
      files.push({
        name: item.name,
        path: item.path,
        kind: item.kind,
        ready: status.ready === true,
        reason: status.reason
      });
    }
    const readyCount = files.filter(function (f) { return f.ready; }).length;
    if (files.length > 0 && readyCount > 0) {
      return { ok: true, files: files, count: files.length, ready_count: readyCount, attempts: round + 1 };
    }
    if (round < retries - 1 && waitMs > 0) {
      await sleepMs(waitMs);
    }
  }

  return { ok: true, files: files, count: files.length, ready_count: 0, attempts: retries };
}
