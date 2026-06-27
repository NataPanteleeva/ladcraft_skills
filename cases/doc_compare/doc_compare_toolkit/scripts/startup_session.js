function isTemplateFileName(name) {
  const lower = name.toLowerCase();
  return lower.endsWith('.md') || lower.endsWith('.markdown');
}

function stripTemplateExtension(name) {
  return name.replace(/\.(md|markdown)$/i, '');
}

async function handlerListTemplates(state) {
  const vfs = getVfs(state);
  if (!vfs || typeof vfs.listDir !== 'function') {
    return { ok: false, error: 'VFS listDir недоступен', templates: [], count: 0 };
  }
  const dir = templatesDir();
  let entries = [];
  try {
    const raw = await vfs.listDir(dir);
    entries = Array.isArray(raw) ? raw : [];
  } catch (e) {
    return { ok: false, error: 'Каталог шаблонов не найден', templates: [], count: 0, templates_dir: dir };
  }
  const templates = [];
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    if (!entry || typeof entry !== 'object') continue;
    const name = typeof entry.name === 'string' ? entry.name.trim() : '';
    if (!name || name === '.' || name === '..') continue;
    const isDir = entry.isDirectory === true || entry.type === 'directory';
    if (isDir) continue;
    if (!isTemplateFileName(name)) continue;
    templates.push({
      name: name,
      display_name: stripTemplateExtension(name),
      path: dir + '/' + name
    });
  }
  templates.sort(function (a, b) {
    return a.display_name.localeCompare(b.display_name, 'ru');
  });
  return { ok: true, templates: templates, count: templates.length, templates_dir: dir };
}

async function handlerResolve(state, params) {
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
      const p = candidates[c];
      const status = await vfsSnapshotReady(vfs, p);
      if (status.ready) {
        return {
          ok: true,
          found: true,
          session_file: p,
          doc_key: docKey,
          attempts: attempts,
          source: sessionFileHint === p ? 'session_file' : 'doc_key'
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
            source: 'scan'
          };
        }
        lastReason = status.reason || 'empty_body';
      }
    }
    if (round < retries - 1) await sleepMs(waitMs);
  }
  return {
    ok: true,
    found: false,
    session_file: candidates.length ? candidates[0] : '',
    doc_key: docKey,
    attempts: attempts,
    reason: lastReason
  };
}

async function handler(state, params) {
  const sessionFileHint = normalizeSessionFilePath(getString(params, 'session_file'));
  let docKey = getString(params, 'doc_key').trim();
  if (!docKey && sessionFileHint) {
    const base = sessionFileHint.split('/').pop() || '';
    const m = base.match(/^r7-word_(.+)\.json$/i);
    if (m) docKey = 'word:' + m[1];
  }
  const docResult = await handlerResolve(state, {
    session_file: sessionFileHint,
    doc_key: docKey,
    retries: getNumber(params, 'retries') || 3,
    wait_ms: getNumber(params, 'wait_ms') || 2000
  });
  const tplResult = await handlerListTemplates(state);
  const templates = tplResult && tplResult.templates ? tplResult.templates : [];
  const lines = [];
  for (let i = 0; i < templates.length; i++) {
    lines.push((i + 1) + '. ' + templates[i].display_name);
  }
  let snapshotLabel = 'документ Word';
  if (docResult && docResult.session_file) {
    const parts = docResult.session_file.split('/');
    const fileName = parts[parts.length - 1] || docResult.session_file;
    snapshotLabel = fileName.replace(/\.json$/i, '');
  }
  let greeting = '';
  if (docResult && docResult.found) {
    greeting += 'Документ получен: **' + snapshotLabel + '**.\n\n';
  } else {
    greeting += 'Документ пока не найден в session VFS — дождитесь завершения upload плагина.\n\n';
  }
  greeting += 'Я — **агент сравнения документов**.\n\n';
  greeting += '**Доступные шаблоны:**\n\n';
  if (lines.length > 0) {
    greeting += lines.join('\n') + '\n\n';
  } else {
    greeting += '_Шаблоны не найдены — добавьте `.md` в папку Templates (Файлы агента)._\n\n';
  }
  greeting += 'Укажите номер или название шаблона для сравнения.';
  return {
    ok: true,
    greeting_markdown: greeting,
    session_file: docResult && docResult.session_file ? docResult.session_file : sessionFileHint,
    doc_key: docKey || (docResult ? docResult.doc_key : ''),
    document: docResult,
    templates: tplResult
  };
}
