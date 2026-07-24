async function handler(state, params) {
  const vfs = getVfs(state);
  if (!vfs) {
    return {
      ok: false,
      reason: 'vfs_unavailable',
      error: 'VFS недоступен',
      session_file: '',
      template_name: '',
      template_text: '',
      document_text: ''
    };
  }

  const templateName = getString(params, 'template_name').trim();
  if (!templateName) {
    return {
      ok: false,
      reason: 'missing_template',
      error: 'template_name обязателен',
      session_file: '',
      template_name: '',
      template_text: '',
      document_text: ''
    };
  }

  const sessionFile = normalizeSessionFilePath(getString(params, 'session_file'));
  if (!sessionFile) {
    return {
      ok: false,
      reason: 'missing_session_file',
      error: 'session_file обязателен (из startup_compare)',
      session_file: '',
      template_name: templateName,
      template_text: '',
      document_text: ''
    };
  }

  const docKey = getString(params, 'doc_key').trim() || docKeyFromSessionFile(sessionFile);

  let limitChars = getNumber(params, 'limit_chars');
  if (!limitChars || limitChars < 1) limitChars = 140000;
  if (limitChars > 300000) limitChars = 300000;

  const templateLimit = getNumber(params, 'template_limit_chars');
  const templateMax = templateLimit > 0 ? templateLimit : 150000;

  const tplPromise = readTemplateText(vfs, templateName, templateMax);
  const docPromise = readR7SnapshotWithTimeout(vfs, sessionFile, 20000);
  const results = await Promise.all([tplPromise, docPromise]);
  const tplResult = results[0];
  const docProbe = results[1];

  if (!tplResult.ok) {
    return {
      ok: false,
      reason: 'template_read_failed',
      error: tplResult.error || 'Не удалось прочитать шаблон',
      session_file: sessionFile,
      doc_key: docKey,
      template_name: templateName,
      template_text: '',
      document_text: ''
    };
  }

  if (!docProbe || !docProbe.ok) {
    return {
      ok: false,
      reason: docProbe && docProbe.reason ? docProbe.reason : 'not_found',
      error: 'Не удалось прочитать snapshot: ' + (docProbe && docProbe.reason ? docProbe.reason : 'not_found'),
      session_file: sessionFile,
      doc_key: docKey,
      template_name: tplResult.name || templateName,
      template_text: tplResult.text || '',
      document_text: ''
    };
  }

  const fullText = docProbe.body_text || '';
  const documentText = fullText.slice(0, limitChars);

  return {
    ok: true,
    reason: 'ready',
    session_file: sessionFile,
    doc_key: docKey,
    template_name: tplResult.name || templateName,
    template_path: tplResult.path,
    template_text: tplResult.text,
    document_text: documentText,
    document_meta: {
      schema: docProbe.schema || 'r7-snapshot/v1',
      truncated: fullText.length > limitChars,
      body_length: fullText.length,
      limit_chars: limitChars,
      template_truncated: Boolean(tplResult.truncated)
    }
  };
}
