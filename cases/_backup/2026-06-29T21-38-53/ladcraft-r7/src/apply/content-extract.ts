import type { R7Task } from "./task-parse";
import { isExportCardTask, stripTaskMarkup } from "./task-parse";

/** Comparison finished — required to show action buttons. */
const COMPARISON_COMPLETE =
  /(?:сравнен[иеё]*\s+завершен|расхождени[йя]\s*[:：]\s*\d+|итого\s*[:：]?\s*\d+\s*расхожден)/i;

const COMPARISON_TABLE =
  /\|\s*(?:пункт|параметр|шаблон)\s*\|[^\n]*\|\s*(?:документ|эталон)\s*\|/i;

const REPORT_SECTION_STARTS = [
  /(?:^|\n)\s*Результаты\s+сравнения\s*:?\s*(?:\n|$)/gim,
  /(?:^|\n)#+\s*Сравнение\s*:/gim,
  /(?:^|\n)#+\s*Результаты\s+сравнения/gim,
  /(?:^|\n)#+\s*Сравнение\s+(?:завершен|документ)/gim,
  /(?:^|\n)Сравнение\s+завершен[оа]?/gim,
  /(?:^|\n)#+\s*Критичн\w*\s+расхожден/gim,
  /(?:^|\n)#+\s*Ключевые\s+(?:расхожден|отличи)/gim,
  /(?:^|\n)#+\s*Неточност\w*/gim,
  /(?:^|\n)#+\s*Сводн\w*/gim,
  /(?:^|\n)#+\s*(?:сравнен|выявлен|обнаружен)/gim,
];

const SUMMARY_TABLE_HEADER =
  /(?:^|\n)\|[^\n]*(?:№|пункт|параметр)[^\n]*\|[^\n]*(?:эталон|требован|шаблон)[^\n]*\|[^\n]*(?:документ|факт)/im;

const REPORT_TABLE_HEADER =
  /(?:^|\n)\|[^\n]*(?:пункт|параметр|шаблон|№)[^\n]*\|[^\n]*\|[^\n]*(?:документ|эталон)/im;

/** End of user-facing report (before «Что дальше?» and follow-ups). */
const REPORT_END_MARKERS = [
  /\n---\s*\n\s*(?:\*\*)?Что дальше\??(?:\*\*)?/i,
  /\n---\s*\n+(?:\*\*)?Что дальше\??(?:\*\*)?/i,
  /\n---\s*\n\s*Чтобы (?:вставить|скачать)/i,
  /\n#+\s*(?:\*\*)?Что дальше\??(?:\*\*)?/i,
  /\n(?:\*\*)?Что дальше\s*[:：]\s*(?:\*\*)?(?:\n|$)/i,
  /\n(?:\*\*)?Что дальше\??(?:\*\*)?\s*(?:\n|$)/i,
  /\nЧтобы вставить отчёт/i,
  /\nЧтобы скачать отчёт/i,
  /\n[-•*]\s*[📋💾📥🔄]?\s*Вставить/i,
  /\n[-•*]\s*[📋💾📥🔄]?\s*(?:Экспорт|Сравнить|Сохрани)/i,
  /\n[-•*]\s*[📋💾]?\s*Сохрани[^\n]*Word/i,
];

/** Content that must never appear in export (template body, tool traces, agent reasoning). */
const REPORT_TRUNCATE_MARKERS = [
  /\n```r7\.task\b/i,
  /\n\*r7\.task\*:/i,
  /\n\| \*{2,3}№\s*п\/п/i,
  /\n\| \*{2,3}1\.\s*\|/i,
  /\n\s*\{"command"\s*:/i,
  /\n(?:The user |Now I need to|Let me |I need to |I'll |I will |Good,|Document [AB] )/m,
  /\nДокумент [AB] загружен из `\.tool_results`/i,
  /\nСодержимое A и B идентично/i,
];

const PROCESS_NOISE =
  /^(?:выбран шаблон|запускаю сравнен|сравниваю документ|читаю оба|оба документа|анализирую|какой шаблон|напишите номер|доступн\w*\s+шаблон)/i;

const TEMPLATE_LIST_ROW = /^\|\s*шаблон\s*\|/i;

const TEMPLATE_PICK =
  /(?:какой шаблон|напишите номер|использовать для сравнения|доступн\w*\s+шаблон|выберите шаблон)/i;

const TEMPLATE_LIST_TABLE = /\|\s*(?:шаблон|название)\s*\|[^\n]*\|/i;

const SERVICE_REPLIES = /^(?:готово!?|ок\.?|done\.?)$/i;

const TEMPLATE_DUMP_LINE = /^\| \*{2,3}№\s*п\/п/i;

const COMPARISON_HEADER = /(?:^|\n)(#{1,3}\s*Сравнение\s*:)/gim;

const DIVERGENCE_SUMMARY = /\*\*Расхождени[ийя]+:\s*\d+/i;

/** Agent gave up on compare before a report (VFS/mount noise) — not a finished turn. */
const COMPARE_FAILURE_ACK =
  /(?:snapshot|снимок).{0,80}недоступен|\/session\/r7\/.{0,40}(?:пуст|не читается|empty|missing)|файл не читается/i;

/** Raw template body leaked from bash head — not for chat merge/display gate. */
export function isTemplateBodyDump(text: string): boolean {
  return /^\| \*{2,3}№\s*п\/п/im.test(text.trim());
}

/** True when assistant text looks like a finished compare report. */
export function isComparisonReport(text: string): boolean {
  const body = text.trim();
  if (!body) return false;
  if (DIVERGENCE_SUMMARY.test(body)) return true;
  if (COMPARISON_COMPLETE.test(body)) return true;
  return COMPARISON_TABLE.test(body) && body.length >= 300;
}

/** True when text is a template picker — must not get action blocks. */
export function isTemplatePickerMessage(text: string): boolean {
  const body = text.trim();
  if (!body) return false;

  const hasCompareMarkers =
    COMPARISON_COMPLETE.test(body) ||
    DIVERGENCE_SUMMARY.test(body) ||
    /(?:^|\n)#+\s*Результаты\s+сравнения/i.test(body);
  if (hasCompareMarkers) return false;

  if (
    TEMPLATE_PICK.test(body) &&
    !/(?:ключевые\s+(?:расхожден|отличи)|сравнен[иеё]*\s+завершен)/i.test(body)
  ) {
    return true;
  }
  if (
    TEMPLATE_LIST_TABLE.test(body) &&
    !/(?:ключевые\s+(?:расхожден|отличи)|сравнен[иеё]*\s+завершен)/i.test(body)
  ) {
    return true;
  }
  return false;
}

/** Premature compare abort — wait gate must keep polling for a real report. */
export function isCompareFailureAck(text: string): boolean {
  const body = text.trim();
  if (!body || isComparisonReport(body)) return false;
  return COMPARE_FAILURE_ACK.test(body);
}

/** True when assistant produced a substantive result (compare or long text). */
export function isSubstantiveResult(text: string): boolean {
  const body = text.trim();
  if (!body || SERVICE_REPLIES.test(body)) return false;
  if (isTemplatePickerMessage(body)) return false;
  if (isCompareFailureAck(body)) return false;
  if (isComparisonReport(body)) return true;
  if (extractReportActionContent(body).length >= 80) return true;
  return body.length >= 120;
}

function findEarliestMatch(body: string, patterns: RegExp[]): number {
  let best = -1;
  for (const re of patterns) {
    const flags = re.flags.includes("g") ? re.flags : `${re.flags}g`;
    const r = new RegExp(re.source, flags);
    let m: RegExpExecArray | null;
    while ((m = r.exec(body)) !== null) {
      if (m.index != null && (best < 0 || m.index < best)) best = m.index;
    }
  }
  return best;
}

function findReportStart(body: string): number {
  const sectionIdx = findEarliestMatch(body, REPORT_SECTION_STARTS);
  if (sectionIdx >= 0) return sectionIdx;
  const summaryTable = SUMMARY_TABLE_HEADER.exec(body);
  if (summaryTable?.index != null) return summaryTable.index;
  const tableMatch = REPORT_TABLE_HEADER.exec(body);
  return tableMatch?.index ?? -1;
}

function findEarliestTruncate(report: string, minIndex = 40): number | null {
  let earliest: number | null = null;
  const patterns = [...REPORT_END_MARKERS, ...REPORT_TRUNCATE_MARKERS];
  for (const re of patterns) {
    const m = report.match(re);
    if (m?.index != null && m.index >= minIndex) {
      if (earliest == null || m.index < earliest) earliest = m.index;
    }
  }
  return earliest;
}

function findReportEnd(report: string): number | null {
  return findEarliestTruncate(report, 40);
}

function splitComparisonBlocks(body: string): string[] {
  const headers: number[] = [];
  let match: RegExpExecArray | null;
  const re = new RegExp(COMPARISON_HEADER.source, COMPARISON_HEADER.flags);
  while ((match = re.exec(body)) !== null) {
    if (match.index != null) {
      headers.push(match.index + (match[0].startsWith("\n") ? 1 : 0));
    }
  }
  if (!headers.length) return [];

  const blocks: string[] = [];
  for (let i = 0; i < headers.length; i++) {
    const start = headers[i];
    const end = i + 1 < headers.length ? headers[i + 1] : body.length;
    blocks.push(body.slice(start, end));
  }
  return blocks;
}

function scoreReportBlock(block: string): number {
  const trimmed = trimReportBlock(block);
  if (trimmed.length < 80) return 0;
  let score = trimmed.length;
  if (DIVERGENCE_SUMMARY.test(trimmed)) score += 500;
  if (SUMMARY_TABLE_HEADER.test(trimmed) || REPORT_TABLE_HEADER.test(trimmed)) score += 300;
  if (TEMPLATE_DUMP_LINE.test(trimmed)) score -= 10_000;
  return score;
}

function trimReportBlock(block: string): string {
  let report = block.trim();
  const endIdx = findReportEnd(report);
  if (endIdx != null) {
    report = report.slice(0, endIdx);
  }
  return stripNoiseLines(report.trim());
}

function pickBestComparisonBlock(body: string): string {
  const blocks = splitComparisonBlocks(body);
  if (!blocks.length) return "";

  let best = "";
  let bestScore = 0;
  for (const block of blocks) {
    const trimmed = trimReportBlock(block);
    const score = scoreReportBlock(block);
    if (score > bestScore) {
      bestScore = score;
      best = trimmed;
    }
  }
  return best;
}

function stripNoiseLines(report: string): string {
  const lines = report.split("\n").filter((line) => {
    const t = line.replace(/^#+\s*/, "").trim();
    if (!t) return true;
    if (PROCESS_NOISE.test(t)) return false;
    if (TEMPLATE_LIST_ROW.test(t)) return false;
    if (/^(?:The user |Now I need|Let me |I need to|I'll |I will )/i.test(t)) return false;
    if (/^\{"command"\s*:/.test(t)) return false;
    return true;
  });
  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

/** Report body for insert/download — without preamble, reasoning, template dump, «Что дальше?». */
export function extractReportActionContent(text: string): string {
  const body = stripTaskMarkup(text).trim();
  if (!body) return "";

  const fromBlocks = pickBestComparisonBlock(body);
  if (fromBlocks.length >= 80) {
    return fromBlocks;
  }

  const startIdx = findReportStart(body);
  let report = startIdx >= 0 ? body.slice(startIdx) : body;

  const endIdx = findReportEnd(report);
  if (endIdx != null) {
    report = report.slice(0, endIdx);
  }

  report = stripNoiseLines(report.trim());
  if (report.length >= 80) {
    return report;
  }

  const endInBody = findEarliestTruncate(body, 40);
  if (endInBody != null) {
    const trimmed = stripNoiseLines(body.slice(0, endInBody).trim());
    const retryStart = findReportStart(trimmed);
    const slice = retryStart >= 0 ? trimmed.slice(retryStart) : trimmed;
    if (slice.length >= 80) return slice;
  }

  return "";
}

/** Sanitize text before export; for compare reports never return raw chat/tool payload. */
export function sanitizeExportContent(text: string, isCompare = false): string {
  const trimmed = stripTaskMarkup(text).trim();
  if (!trimmed) return "";
  if (isCompare && DIVERGENCE_SUMMARY.test(trimmed) && /\n\|.+\|/m.test(trimmed)) {
    const cleaned = extractReportActionContent(trimmed);
    if (!cleaned || cleaned.length < trimmed.length * 0.6) {
      return stripNoiseLines(trimReportBlock(trimmed)) || trimmed;
    }
    return cleaned;
  }
  const cleaned = extractReportActionContent(trimmed);
  if (cleaned.length >= 80) return cleaned;
  if (isCompare) return cleaned;
  return trimmed;
}

/** Paste payload from r7.task when insert is deferred to UI buttons. */
export function extractDeferredInsertContent(tasks: R7Task[]): string | undefined {
  for (const task of tasks) {
    if (task.type === "paste" || task.type === "paste_text") {
      const data = task.data.trim();
      if (!data) continue;
      const cleaned = extractReportActionContent(data);
      if (cleaned) return cleaned;
    }
    if (task.type === "deliver_inline" && typeof task.data.content === "string") {
      const content = task.data.content.trim();
      if (!content) continue;
      const cleaned = extractReportActionContent(content);
      if (cleaned) return cleaned;
    }
  }
  return undefined;
}

export function hasExportCardTasks(tasks: R7Task[]): boolean {
  return tasks.some((t) => isExportCardTask(t.type));
}
