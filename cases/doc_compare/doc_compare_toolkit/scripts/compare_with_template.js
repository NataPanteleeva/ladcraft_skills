async function handler(state, params) {
  const vfs = getVfs(state);
  if (!vfs || typeof vfs.readFile !== 'function') {
    return { ok: false, error: 'VFS readFile недоступен' };
  }

  const templateName = getString(params, 'template_name').trim();
  if (!templateName) {
    return { ok: false, error: 'template_name обязателен' };
  }

  const templatePath = templatesDir() + '/' + templateName.replace(/^\/+/, '');
  let templateExists = false;
  if (typeof vfs.exists === 'function') {
    try {
      templateExists = await vfs.exists(templatePath);
    } catch (e) {
      templateExists = false;
    }
  }
  if (!templateExists) {
    try {
      const probe = await vfs.readFile(templatePath);
      templateExists = typeof probe === 'string';
    } catch (e) {
      templateExists = false;
    }
  }
  if (!templateExists) {
    return { ok: false, error: 'Шаблон не найден: ' + templateName, template_name: templateName };
  }

  const reportFile = reportPath();
  let reportMarkdown = '';
  try {
    reportMarkdown = await vfs.readFile(reportFile);
  } catch (e) {
    return { ok: false, error: 'Не удалось получить отчёт сравнения', template_name: templateName };
  }
  if (typeof reportMarkdown !== 'string' || !reportMarkdown.trim()) {
    return { ok: false, error: 'Отчёт сравнения пуст', template_name: templateName };
  }

  return {
    ok: true,
    template_name: templateName,
    template_path: templatePath,
    report_markdown: reportMarkdown
  };
}
