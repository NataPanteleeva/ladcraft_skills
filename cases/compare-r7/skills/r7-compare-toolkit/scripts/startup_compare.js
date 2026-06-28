async function handler(state, params) {
  const vfs = getVfs(state);
  const sessionFile = normalizeSessionFilePath(getString(params, 'session_file'));
  const docKey = getString(params, 'doc_key').trim() || docKeyFromSessionFile(sessionFile);

  const templates = vfs ? await listWorkspaceTemplates(vfs) : [];

  const numbered = [];
  for (let i = 0; i < templates.length; i++) {
    numbered.push((i + 1) + '. `' + templates[i].name + '`');
  }

  const parts = sessionFile ? sessionFile.split('/') : [];
  const snapshotName = parts.length ? parts[parts.length - 1] : '';

  let greeting_markdown = '**Агент сравнения документов.**\n\n';
  if (snapshotName) {
    greeting_markdown += 'Документ: `' + snapshotName + '`.\n\n';
  }

  greeting_markdown += '**Выберите шаблон** (имя или №):\n\n';
  if (numbered.length > 0) {
    greeting_markdown += numbered.join('\n') + '\n';
  } else {
    greeting_markdown += '_Шаблоны не найдены в `/workspace/Templates/`._\n';
  }

  return {
    ok: true,
    found: true,
    greeting_markdown: greeting_markdown,
    session_file: sessionFile,
    doc_key: docKey || docKeyFromSessionFile(sessionFile),
    templates: templates
  };
}
