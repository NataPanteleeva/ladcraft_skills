function cleanMd(value) {
  return String(value || '')
    .replace(/\*+/g, '')
    .replace(/\\n/g, '\n')
    .replace(/\\r/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function truncateText(value, maxLen) {
  const s = String(value || '').trim();
  const n = typeof maxLen === 'number' && maxLen > 0 ? maxLen : 200;
  if (s.length <= n) return s;
  return s.slice(0, n - 1) + '…';
}

function normalizeCompareText(value) {
  return cleanMd(value)
    .toLowerCase()
    .replace(/[«»""']/g, '"')
    .replace(/\s+/g, ' ')
    .trim();
}

function stripHtml(value) {
  return String(value || '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<\/tr>/gi, '\n')
    .replace(/<\/td>/gi, '\t')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\t+/g, '\t')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function normalizeClauseId(raw) {
  const s = String(raw || '').replace(/\*+/g, '').trim();
  const m = s.match(/(\d+(?:\.\d+)*)/);
  return m ? m[1] : '';
}

function detectDocumentMode(text) {
  const sample = String(text || '').slice(0, 80000);
  if (!sample.trim()) return 'text_blocks';
  const hasMarkdownTable = /\|[\s*]*\d+\.\d+/.test(sample);
  const hasHtmlTable = /<table/i.test(sample);
  const clauseMatches = sample.match(/\b\d+\.\d+(?:\.\d+)+\b/g);
  const clauseCount = clauseMatches ? clauseMatches.length : 0;
  if (hasMarkdownTable || hasHtmlTable || clauseCount >= 8) return 'table_clauses';
  return 'text_blocks';
}

function slugBlockId(label, index) {
  const base = cleanMd(label)
    .toLowerCase()
    .replace(/[^a-z0-9а-яё]+/gi, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  if (base) return base;
  return 'p:' + String(index);
}

function pickRequirementFromCells(cells, source) {
  if (!cells || !cells.length) return '';
  if (source === 'template') {
    if (cells.length >= 3) return cells[2];
    return cells[1] || '';
  }
  if (cells.length >= 4) return cells[2] || cells[1];
  if (cells.length >= 3) {
    const c2 = String(cells[2] || '').toLowerCase();
    if (c2.indexOf('наличие') === 0) return cells[1] || '';
    return cells[2] || cells[1] || '';
  }
  return cells[1] || cells[0] || '';
}

function parseMarkdownTableClauses(text, source) {
  const units = [];
  const seen = {};
  const lines = String(text || '').split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line.startsWith('|')) continue;
    if (/^\|\s*-/.test(line)) continue;
    const cells = line
      .split('|')
      .map(function (c) { return cleanMd(c); })
      .filter(function (c) { return c.length > 0; });
    if (cells.length < 2) continue;
    const id = normalizeClauseId(cells[0]);
    if (!id) continue;
    const label = cells.length >= 3 ? cells[1] : '';
    const req = pickRequirementFromCells(cells, source);
    if (!req || req.length < 2) continue;
    const key = id + '|' + normalizeCompareText(req).slice(0, 40);
    if (seen[key]) continue;
    seen[key] = true;
    units.push({
      id: id,
      label: label,
      text: req,
      kind: 'table_row',
      source: source
    });
  }
  return units;
}

function parseHtmlTableClauses(html, source) {
  const units = [];
  const seen = {};
  const rowRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let rowMatch = rowRe.exec(html);
  while (rowMatch) {
    const cells = [];
    const cellRe = /<td[^>]*>([\s\S]*?)<\/td>/gi;
    let cellMatch = cellRe.exec(rowMatch[1]);
    while (cellMatch) {
      cells.push(cleanMd(stripHtml(cellMatch[1])));
      cellMatch = cellRe.exec(rowMatch[1]);
    }
    if (cells.length >= 2) {
      const id = normalizeClauseId(cells[0]);
      if (id) {
        const label = cells.length >= 3 ? cells[1] : '';
        const req = pickRequirementFromCells(cells, source);
        if (req && req.length >= 2) {
          const key = id + '|' + normalizeCompareText(req).slice(0, 40);
          if (!seen[key]) {
            seen[key] = true;
            units.push({
              id: id,
              label: label,
              text: req,
              kind: 'table_row',
              source: source
            });
          }
        }
      }
    }
    rowMatch = rowRe.exec(html);
  }
  return units;
}

function parseTableClauses(text, source) {
  const raw = String(text || '');
  if (/<table/i.test(raw)) {
    const fromHtml = parseHtmlTableClauses(raw, source);
    if (fromHtml.length > 0) return fromHtml;
  }
  return parseMarkdownTableClauses(raw, source);
}

function parseTextBlocks(text, source) {
  const plain = /<[^>]+>/.test(text) ? stripHtml(text) : String(text || '');
  const parts = plain.split(/\n{2,}/);
  const units = [];
  for (let i = 0; i < parts.length; i++) {
    const trimmed = parts[i].trim();
    if (!trimmed || trimmed.length < 8) continue;
    let label = '';
    const headingMatch = trimmed.match(/^(#{1,6}\s+[^\n]+|\*\*[^*\n]+\*\*)/);
    if (headingMatch) label = cleanMd(headingMatch[1]);
    units.push({
      id: slugBlockId(label, i),
      label: label,
      text: trimmed,
      kind: 'paragraph',
      source: source
    });
  }
  return units;
}

function blockSimilarity(a, b) {
  const la = normalizeCompareText(a.label || a.text.slice(0, 80));
  const lb = normalizeCompareText(b.label || b.text.slice(0, 80));
  if (!la || !lb) return 0;
  if (la === lb) return 1;
  if (la.indexOf(lb) >= 0 || lb.indexOf(la) >= 0) return 0.75;
  const ta = la.split(' ').filter(Boolean);
  const tb = lb.split(' ').filter(Boolean);
  if (!ta.length || !tb.length) return 0;
  let common = 0;
  for (let i = 0; i < ta.length; i++) {
    if (tb.indexOf(ta[i]) >= 0) common += 1;
  }
  return common / Math.max(ta.length, tb.length);
}

function classifySeverity(templateText, docText) {
  const blob = (String(templateText || '') + ' ' + String(docText || '')).toLowerCase();
  if (/лиценз|гарант|срок|месяц|год|os|операцион|500|реестр|совместим/.test(blob)) {
    return 'critical';
  }
  if (/опечат|формат|регистр/.test(blob)) {
    return 'info';
  }
  return 'warning';
}

function diffTypeLabel(diff) {
  if (diff.type === 'missing_in_doc') return '⚠️ отсутствует в документе';
  if (diff.type === 'missing_in_template') return 'Δ лишнее в документе';
  if (diff.severity === 'critical') return '⚠️ критичное';
  if (diff.severity === 'info') return '📝 опечатка';
  return 'Δ отличие';
}

function alignTableClauses(unitsA, unitsB) {
  const mapA = {};
  const mapB = {};
  for (let i = 0; i < unitsA.length; i++) {
    if (unitsA[i].id) mapA[unitsA[i].id] = unitsA[i];
  }
  for (let j = 0; j < unitsB.length; j++) {
    if (!unitsB[j].id) continue;
    if (!mapB[unitsB[j].id] || unitsB[j].text.length > mapB[unitsB[j].id].text.length) {
      mapB[unitsB[j].id] = unitsB[j];
    }
  }

  const diffs = [];
  const seenB = {};

  for (const id in mapA) {
    const a = mapA[id];
    const b = mapB[id];
    if (!b) {
      diffs.push({
        type: 'missing_in_doc',
        id: id,
        label: a.label,
        templateText: a.text,
        docText: '',
        severity: classifySeverity(a.text, '')
      });
      continue;
    }
    seenB[id] = true;
    const normA = normalizeCompareText(a.text);
    const normB = normalizeCompareText(b.text);
    if (normA === normB) continue;
    diffs.push({
      type: 'text_mismatch',
      id: id,
      label: a.label || b.label,
      templateText: a.text,
      docText: b.text,
      severity: classifySeverity(a.text, b.text)
    });
  }

  for (const id in mapB) {
    if (seenB[id]) continue;
    if (!mapA[id]) {
      diffs.push({
        type: 'missing_in_template',
        id: id,
        label: mapB[id].label,
        templateText: '',
        docText: mapB[id].text,
        severity: 'warning'
      });
    }
  }

  return diffs;
}

function alignTextBlocks(unitsA, unitsB) {
  const diffs = [];
  const usedB = {};

  for (let i = 0; i < unitsA.length; i++) {
    const a = unitsA[i];
    let bestJ = -1;
    let bestScore = 0;
    for (let j = 0; j < unitsB.length; j++) {
      if (usedB[j]) continue;
      const score = blockSimilarity(a, unitsB[j]);
      if (score > bestScore) {
        bestScore = score;
        bestJ = j;
      }
    }
    if (bestJ >= 0 && bestScore >= 0.35) {
      usedB[bestJ] = true;
      const b = unitsB[bestJ];
      if (normalizeCompareText(a.text) !== normalizeCompareText(b.text)) {
        diffs.push({
          type: 'text_mismatch',
          id: a.id,
          label: a.label || b.label,
          templateText: a.text,
          docText: b.text,
          severity: classifySeverity(a.text, b.text)
        });
      }
    } else {
      diffs.push({
        type: 'missing_in_doc',
        id: a.id,
        label: a.label,
        templateText: a.text,
        docText: '',
        severity: 'warning'
      });
    }
  }

  for (let j = 0; j < unitsB.length; j++) {
    if (usedB[j]) continue;
    diffs.push({
      type: 'missing_in_template',
      id: unitsB[j].id,
      label: unitsB[j].label,
      templateText: '',
      docText: unitsB[j].text,
      severity: 'info'
    });
  }

  return diffs;
}

function diffToRow(diff) {
  return [
    diff.id || '',
    diff.label || '',
    truncateText(diff.templateText, 180),
    truncateText(diff.docText, 180),
    diffTypeLabel(diff)
  ];
}

function buildCompareReport(options) {
  const templateName = options.templateName || 'template.md';
  const sessionFile = options.sessionFile || '';
  const diffs = options.diffs || [];
  const mode = options.mode || 'text_blocks';
  const warnings = options.warnings || [];
  const docBName = sessionFile.split('/').pop() || 'document';

  const critical = diffs.filter(function (d) { return d.severity === 'critical'; });
  const other = diffs.filter(function (d) { return d.severity !== 'critical'; });

  const criticalRows = critical.map(diffToRow);
  const otherRows = other.map(diffToRow);

  const sections = [];
  if (criticalRows.length > 0) {
    sections.push({
      heading: 'Критичные расхождения',
      level: 2,
      tables: [{
        headers: ['Пункт', 'Параметр', 'Эталон', 'Документ', 'Тип'],
        rows: criticalRows
      }],
      quotes: []
    });
  }
  if (otherRows.length > 0) {
    sections.push({
      heading: 'Прочие расхождения',
      level: 2,
      tables: [{
        headers: ['Пункт', 'Параметр', 'Эталон', 'Документ', 'Тип'],
        rows: otherRows
      }],
      quotes: []
    });
  }

  const baseName = templateName.replace(/\.md$/i, '');
  return {
    schema: 'doc-compare/v1',
    title: 'Сравнение документов',
    meta: {
      documentA: { name: templateName, role: 'эталон' },
      documentB: { name: docBName, role: 'сравниваемый' },
      totalDiffs: diffs.length,
      parseMode: mode,
      parseQuality: warnings.length > 0 ? 'medium' : 'high',
      warnings: warnings
    },
    sections: sections,
    summaryTable: {
      headers: ['Категория', 'Кол-во'],
      rows: [
        ['Критичные', String(critical.length)],
        ['Прочие', String(other.length)],
        ['Всего', String(diffs.length)]
      ]
    },
    risks: critical.slice(0, 8).map(function (d) {
      return (d.label || d.id || 'Пункт') + ': ' + truncateText(d.docText || d.templateText, 100);
    }),
    suggestedFileName: 'сравнение_' + baseName + '.docx'
  };
}

function renderChatMarkdown(report, maxRows) {
  const limit = typeof maxRows === 'number' && maxRows > 0 ? maxRows : 20;
  const total = report.meta && typeof report.meta.totalDiffs === 'number'
    ? report.meta.totalDiffs
    : 0;
  const docA = report.meta && report.meta.documentA ? report.meta.documentA.name : 'эталон';
  const docB = report.meta && report.meta.documentB ? report.meta.documentB.name : 'документ';

  let md = '## Резюме\n\n';
  md += 'Сравнение `' + docA + '` с `' + docB + '`.\n\n';
  md += '**Расхождений: ' + total + '**';
  if (report.meta && report.meta.parseMode) {
    md += ' (режим: ' + report.meta.parseMode + ')';
  }
  md += '\n';

  if (report.meta && Array.isArray(report.meta.warnings) && report.meta.warnings.length > 0) {
    md += '\n> ' + report.meta.warnings.join(' ') + '\n';
  }

  const allRows = [];
  const sections = report.sections || [];
  for (let s = 0; s < sections.length; s++) {
    const sec = sections[s];
    if (!sec || !Array.isArray(sec.tables)) continue;
    for (let t = 0; t < sec.tables.length; t++) {
      const table = sec.tables[t];
      if (!table || !Array.isArray(table.rows)) continue;
      for (let r = 0; r < table.rows.length; r++) {
        allRows.push(table.rows[r]);
      }
    }
  }

  if (allRows.length > 0) {
    md += '\n| Пункт | Параметр | Эталон | Документ | Тип |\n';
    md += '| - | - | - | - | - |\n';
    const shown = allRows.slice(0, limit);
    for (let i = 0; i < shown.length; i++) {
      const row = shown[i];
      md += '| ' + row.join(' | ') + ' |\n';
    }
    if (allRows.length > limit) {
      md += '\n_… и ещё ' + (allRows.length - limit) + ' расхождений (полный список в CompareReport)._ \n';
    }
  } else {
    md += '\nСущественных расхождений не найдено.\n';
  }

  md += '\n---\n\n**Что дальше?** Напишите **вставить** — кнопки вставки в документ; **скачать** — .md/.html в плагине; **скачать docx** / **сохрани в Word** — отчёт Word через агента.\n';
  return md;
}

function formatCompareR7TaskBlock(report) {
  const tasks = [{
    type: 'deliver_inline',
    data: {
      fileName: 'compare-report.json',
      mimeType: 'application/json',
      encoding: 'utf8',
      content: JSON.stringify(report),
      actions: []
    }
  }];
  return '```r7.task\n' + JSON.stringify(tasks, null, 2) + '\n```';
}

function resolveCompareMode(modeA, modeB) {
  const warnings = [];
  if (modeA === modeB) return { mode: modeA, warnings: warnings };
  warnings.push('Формат шаблона (' + modeA + ') и документа (' + modeB + ') различаются — сравнение по текстовым блокам.');
  return { mode: 'text_blocks', warnings: warnings };
}

function runDocumentCompare(templateText, docText, options) {
  const modeA = detectDocumentMode(templateText);
  const modeB = detectDocumentMode(docText);
  const resolved = resolveCompareMode(modeA, modeB);
  const mode = resolved.mode;
  const warnings = resolved.warnings.slice();

  const unitsA = mode === 'table_clauses'
    ? parseTableClauses(templateText, 'template')
    : parseTextBlocks(templateText, 'template');
  const unitsB = mode === 'table_clauses'
    ? parseTableClauses(docText, 'document')
    : parseTextBlocks(docText, 'document');

  if (unitsA.length === 0 || unitsB.length === 0) {
    warnings.push('Мало структурированных блоков для сравнения (A=' + unitsA.length + ', B=' + unitsB.length + ').');
  }

  const diffs = mode === 'table_clauses'
    ? alignTableClauses(unitsA, unitsB)
    : alignTextBlocks(unitsA, unitsB);

  return {
    mode: mode,
    warnings: warnings,
    diffs: diffs,
    stats: {
      template_units: unitsA.length,
      document_units: unitsB.length,
      template_mode: modeA,
      document_mode: modeB
    }
  };
}
