async function handler(state, params) {
  const sessionFileHint = normalizeSessionFilePath(getString(params, 'session_file'));
  let docKey = getString(params, 'doc_key').trim();
  if (!docKey && sessionFileHint) {
    docKey = docKeyFromSessionFile(sessionFileHint);
  }

  const resolveParams = {
    session_file: sessionFileHint,
    doc_key: docKey,
    retries: getNumber(params, 'retries') || 3,
    wait_ms: getNumber(params, 'wait_ms') || 2000
  };

  const docResult = await handlerResolve(state, resolveParams);
  const tplResult = await handlerListTemplates(state, {});

  const templates = tplResult && tplResult.templates ? tplResult.templates : [];
  const numbered = [];
  for (let i = 0; i < templates.length; i++) {
    numbered.push((i + 1) + '. `' + templates[i].name + '`');
  }

  let snapshotName = '';
  if (docResult && docResult.session_file) {
    const parts = docResult.session_file.split('/');
    snapshotName = parts[parts.length - 1] || docResult.session_file;
  }

  let greeting_markdown = '**Агент сравнения документов.**\n\n';
  if (docResult && docResult.found) {
    greeting_markdown +=
      'Получен открытый документ из R7: `' +
      snapshotName +
      '` (snapshot готов).\n\n';
  } else {
    greeting_markdown +=
      'Документ R7 пока не найден в session VFS — подождите завершения upload плагина.\n\n';
  }

  greeting_markdown += '**Шаблоны для сравнения** (папка `Templates` в «Файлах агента»):\n\n';
  if (numbered.length > 0) {
    greeting_markdown += numbered.join('\n') + '\n\n';
  } else {
    greeting_markdown +=
      '_Шаблоны не найдены — добавьте `.md` в `/workspace/Templates/`._\n\n';
  }
  greeting_markdown += 'Выберите шаблон — укажите **имя** или **№** из списка.';

  return {
    ok: true,
    document: docResult,
    templates: tplResult,
    greeting_markdown: greeting_markdown,
    session_file: docResult ? docResult.session_file : sessionFileHint,
    doc_key: docKey || (docResult ? docResult.doc_key : '')
  };
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
    hint: 'Повторите startup_compare через несколько секунд или дождитесь upload плагина.'
  };
}

async function handlerListTemplates(state, params) {
  const vfs = getVfs(state);
  if (!vfs || typeof vfs.listDir !== 'function') {
    return { ok: false, error: 'VFS listDir недоступен', templates: [] };
  }

  const dir = templatesDir();
  let entries = [];
  try {
    const raw = await vfs.listDir(dir);
    entries = Array.isArray(raw) ? raw : [];
  } catch (e) {
    return { ok: false, error: 'Каталог шаблонов не найден', templates: [], templates_dir: dir };
  }

  const templates = [];
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    if (!entry || typeof entry !== 'object') continue;
    const name = typeof entry.name === 'string' ? entry.name : '';
    if (!name || name === '.' || name === '..') continue;
    const isDir = entry.isDirectory === true || entry.type === 'directory';
    if (isDir) continue;
    templates.push({
      name: name,
      path: dir + '/' + name
    });
  }

  templates.sort(function (a, b) {
    return a.name.localeCompare(b.name, 'ru');
  });

  return { ok: true, templates: templates, count: templates.length, templates_dir: dir };
}

function docKeyFromSessionFile(sessionFile) {
  const path = normalizeSessionFilePath(sessionFile);
  if (!path) return '';
  const parts = path.split('/');
  const name = parts[parts.length - 1] || '';
  if (name.indexOf('r7-') !== 0 || name.indexOf('.json') !== name.length - 5) return '';
  const inner = name.slice(3, -5);
  const sep = inner.indexOf('_');
  if (sep <= 0) return '';
  return inner.slice(0, sep) + ':' + inner.slice(sep + 1);
}
