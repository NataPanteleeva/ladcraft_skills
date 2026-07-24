async function handler(state, params) {
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
