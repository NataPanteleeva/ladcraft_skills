async function handler(state, params) {
  const vfs = getVfs(state);
  if (!vfs || typeof vfs.readFile !== 'function') {
    return {
      ok: false,
      error: 'VFS readFile недоступен',
      compare_report: null,
      chat_markdown: '',
      r7_task_block: ''
    };
  }

  const templateName = getString(params, 'template_name').trim();
  if (!templateName) {
    return {
      ok: false,
      error: 'template_name обязателен (имя файла из Templates, с расширением .md)',
      compare_report: null,
      chat_markdown: '',
      r7_task_block: ''
    };
  }

  const sessionFile = normalizeSessionFilePath(getString(params, 'session_file'));
  if (!sessionFile) {
    return {
      ok: false,
      error: 'session_file обязателен (path из startup_compare / mentioned.files)',
      compare_report: null,
      chat_markdown: '',
      r7_task_block: ''
    };
  }

  let maxChatRows = getNumber(params, 'max_chat_rows');
  if (!maxChatRows || maxChatRows < 1) maxChatRows = 20;
  if (maxChatRows > 50) maxChatRows = 50;

  const templatePath = templatesDir() + '/' + templateName.replace(/^\/+/, '');
  let templateText = '';
  try {
    templateText = coerceVfsReadToString(await vfs.readFile(templatePath));
  } catch (e) {
    return {
      ok: false,
      error: 'Шаблон не найден или не читается: ' + templatePath,
      compare_report: null,
      chat_markdown: '',
      r7_task_block: ''
    };
  }
  if (!templateText || !templateText.trim()) {
    return {
      ok: false,
      error: 'Шаблон пуст: ' + templatePath,
      compare_report: null,
      chat_markdown: '',
      r7_task_block: ''
    };
  }

  const probe = await readR7SnapshotOriginal(vfs, sessionFile);
  if (!probe.ok) {
    return {
      ok: false,
      error: 'Snapshot не готов: ' + probe.reason,
      compare_report: null,
      chat_markdown: '',
      r7_task_block: '',
      session_file: sessionFile,
      reason: probe.reason
    };
  }

  const docText = probe.body_text || '';
  const compareResult = runDocumentCompare(templateText, docText, {
    templateName: templateName,
    sessionFile: sessionFile
  });

  const compareReport = buildCompareReport({
    templateName: templateName,
    sessionFile: sessionFile,
    diffs: compareResult.diffs,
    mode: compareResult.mode,
    warnings: compareResult.warnings
  });

  const chatMarkdown = renderChatMarkdown(compareReport, maxChatRows);
  const r7TaskBlock = formatCompareR7TaskBlock(compareReport);

  return {
    ok: true,
    compare_report: compareReport,
    chat_markdown: chatMarkdown,
    r7_task_block: r7TaskBlock,
    stats: {
      total_diffs: compareResult.diffs.length,
      template_chars: templateText.length,
      document_chars: docText.length,
      template_units: compareResult.stats.template_units,
      document_units: compareResult.stats.document_units,
      parse_mode: compareResult.mode,
      template_mode: compareResult.stats.template_mode,
      document_mode: compareResult.stats.document_mode
    },
    session_file: sessionFile,
    template_path: templatePath
  };
}
