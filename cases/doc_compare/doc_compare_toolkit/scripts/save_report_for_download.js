async function handler(state, params) {
  const vfs = getVfs(state);
  if (!vfs || typeof vfs.writeFile !== 'function') {
    return { ok: false, error: 'VFS writeFile недоступен' };
  }

  const reportMarkdown = getString(params, 'report_markdown');
  if (!reportMarkdown.trim()) {
    return { ok: false, error: 'report_markdown обязателен' };
  }

  let fileName = getString(params, 'file_name').trim();
  if (!fileName) {
    fileName = 'otchet_sravneniya.md';
  }
  fileName = fileName.replace(/^\/+/, '').replace(/\.\./g, '');
  if (!fileName.toLowerCase().endsWith('.md')) {
    fileName = fileName + '.md';
  }

  const destPath = '/workspace/' + fileName;
  await vfs.writeFile(destPath, reportMarkdown.trim() + '\n');

  return {
    ok: true,
    download_path: destPath,
    file_name: fileName
  };
}
