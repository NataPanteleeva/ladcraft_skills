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
      document_text: '',
      bash_fallback_hint: ''
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
      document_text: '',
      bash_fallback_hint: ''
    };
  }

  const sessionFile = normalizeSessionFilePath(getString(params, 'session_file'));
  if (!sessionFile) {
    return {
      ok: false,
      reason: 'missing_session_file',
      error: 'session_file обязателен (из mentioned.files)',
      session_file: '',
      template_name: templateName,
      template_text: '',
      document_text: '',
      bash_fallback_hint: ''
    };
  }

  const docKey = getString(params, 'doc_key').trim() || docKeyFromSessionFile(sessionFile);

  let limitChars = getNumber(params, 'limit_chars');
  if (!limitChars || limitChars < 1) limitChars = 200000;
  if (limitChars > 300000) limitChars = 300000;

  const templateLimit = getNumber(params, 'template_limit_chars');
  const templateMax = templateLimit > 0 ? templateLimit : 150000;

  const tplPromise = readTemplateText(vfs, templateName, templateMax);
  const docPromise = readR7SnapshotFast(vfs, sessionFile, 8000);
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
      document_text: '',
      bash_fallback_hint: ''
    };
  }

  if (!docProbe || !docProbe.ok) {
    const reason = docProbe && docProbe.reason ? docProbe.reason : 'not_found';
    return {
      ok: false,
      reason: reason,
      error: 'Не удалось прочитать snapshot: ' + reason,
      session_file: sessionFile,
      doc_key: docKey,
      template_name: tplResult.name || templateName,
      template_text: tplResult.text || '',
      document_text: '',
      bash_fallback_hint:
        'bash head -c 200000 "' +
        sessionFile +
        '" (извлеки body.text); затем сразу отчёт без дополнительных tool'
    };
  }

  const fullText = docProbe.body_text || '';
  const documentText = fullText.slice(0, limitChars);
  const templateText = tplResult.text || '';
  const warnings = [];

  if (fullText.length > limitChars) {
    warnings.push(
      'document_truncated: сравнение по первым ' + String(limitChars) + ' символам body.text'
    );
  }
  if (tplResult.truncated) {
    warnings.push(
      'template_truncated: сравнение по первым ' + String(templateMax) + ' символам шаблона'
    );
  }

  return {
    ok: true,
    reason: 'ready',
    session_file: sessionFile,
    doc_key: docKey,
    template_name: tplResult.name || templateName,
    template_path: tplResult.path,
    template_text: templateText,
    document_text: documentText,
    template_chars: templateText.length,
    document_chars: documentText.length,
    body_length: fullText.length,
    truncated: {
      template: Boolean(tplResult.truncated),
      document: fullText.length > limitChars
    },
    warnings: warnings,
    document_meta: {
      schema: docProbe.schema || 'r7-snapshot/v1',
      limit_chars: limitChars,
      template_limit_chars: templateMax
    }
  };
}
