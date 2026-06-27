function isTemplateFileName(name) {
  const lower = name.toLowerCase();
  return lower.endsWith('.md') || lower.endsWith('.markdown');
}

function stripTemplateExtension(name) {
  return name.replace(/\.(md|markdown)$/i, '');
}

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

  return {
    ok: true,
    templates: templates,
    count: templates.length,
    templates_dir: dir
  };
}
