async function handler(state, params) {
  const vfs = getVfs(state);
  if (!vfs || typeof vfs.writeFile !== 'function') {
    return { ok: false, error: 'VFS writeFile недоступен' };
  }

  const sessionFile = getString(params, 'session_file').trim();
  const reportMarkdown = getString(params, 'report_markdown');
  if (!sessionFile) {
    return { ok: false, error: 'session_file обязателен' };
  }
  if (!reportMarkdown.trim()) {
    return { ok: false, error: 'report_markdown обязателен' };
  }

  const snapshotPath = sessionFile.startsWith('/session/')
    ? sessionFile
    : sessionPath(sessionFile.replace(/^\/+/, ''));

  const reportFileName = 'otchet_sravneniya_dlya_vstavki.md';
  const workspacePath = '/workspace/' + reportFileName;

  const header =
    '<!-- compare-report source_snapshot: ' + snapshotPath + ' -->\n\n';
  await vfs.writeFile(workspacePath, header + reportMarkdown.trim() + '\n');

  return {
    ok: true,
    session_file: snapshotPath,
    workspace_report_path: workspacePath,
    file_name: reportFileName,
    note: 'Отчёт сохранён в workspace для вставки в документ R7 через r7-export.'
  };
}
