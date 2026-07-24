import type { HistoryMessage } from "../eai/session";
import { extractReportActionContent } from "./content-extract";
import { extractTasksFromReply } from "./executor";
import type { R7Task } from "./task-parse";

export interface CompareTable {
  headers: string[];
  rows: string[][];
}

export interface CompareSection {
  heading?: string;
  level?: number;
  tables?: CompareTable[];
  quotes?: string[];
}

/** Structured doc-compare skill output (doc-compare/v1). */
export interface CompareReport {
  schema?: string;
  title?: string;
  meta?: {
    documentA?: { name?: string; role?: string };
    documentB?: { name?: string; role?: string };
    totalDiffs?: number;
  };
  sections?: CompareSection[];
  summaryTable?: CompareTable;
  risks?: string[];
  suggestedFileName?: string;
  /** Full visible report markdown from agent (preferred over sections assembly). */
  chatMarkdown?: string;
  /** Snake_case alias from agent JSON. */
  chat_markdown?: string;
}

/** True when object matches CompareReport shape with renderable content. */
export function isCompareReport(value: unknown): value is CompareReport {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const obj = value as Record<string, unknown>;
  const chatMd =
    (typeof obj.chatMarkdown === "string" && obj.chatMarkdown.trim()) ||
    (typeof obj.chat_markdown === "string" && obj.chat_markdown.trim());
  if (chatMd) return true;
  return hasCompareReportTables(obj);
}

function hasCompareReportTables(obj: Record<string, unknown>): boolean {
  const summary = obj.summaryTable;
  if (summary && typeof summary === "object" && isNonEmptyTable(summary as CompareTable)) {
    return true;
  }
  const sections = obj.sections;
  if (!Array.isArray(sections) || !sections.length) return false;
  return sections.some((section) => {
    if (!section || typeof section !== "object") return false;
    const tables = (section as CompareSection).tables;
    return Array.isArray(tables) && tables.some((t) => isNonEmptyTable(t));
  });
}

function isNonEmptyTable(table: CompareTable): boolean {
  return Boolean(table.headers?.length) || Boolean(table.rows?.length);
}

/** Markdown for Word insert — full report from skill JSON, not chat excerpt. */
export function compareReportToMarkdown(report: CompareReport): string {
  const chatMd = report.chatMarkdown?.trim() || report.chat_markdown?.trim();
  if (chatMd) {
    return chatMd.replace(/\n{3,}/g, "\n\n").trim();
  }

  const lines: string[] = [];

  if (report.title?.trim()) {
    lines.push(`# ${report.title.trim()}`, "");
  }

  const meta = report.meta;
  if (meta?.documentA?.name || meta?.documentB?.name) {
    const parts: string[] = [];
    if (meta.documentA?.name) {
      parts.push(`**${meta.documentA.role ?? "эталон"}:** ${meta.documentA.name}`);
    }
    if (meta.documentB?.name) {
      parts.push(`**${meta.documentB.role ?? "документ"}:** ${meta.documentB.name}`);
    }
    lines.push(parts.join(" · "));
  }
  if (meta?.totalDiffs != null) {
    lines.push(`**Расхождений:** ${meta.totalDiffs}`);
  }
  if (lines.length && lines[lines.length - 1] !== "") lines.push("");

  for (const section of report.sections ?? []) {
    if (section.heading?.trim()) {
      const level = Math.min(Math.max(section.level ?? 2, 1), 6);
      lines.push(`${"#".repeat(level)} ${section.heading.trim()}`, "");
    }
    for (const table of section.tables ?? []) {
      const md = tableToMarkdown(table);
      if (md) lines.push(md, "");
    }
    for (const quote of section.quotes ?? []) {
      if (quote.trim()) lines.push(`> ${quote.trim()}`, "");
    }
  }

  if (report.summaryTable?.headers?.length) {
    lines.push("## Сводка", "");
    const md = tableToMarkdown(report.summaryTable);
    if (md) lines.push(md, "");
  }

  if (report.risks?.length) {
    lines.push("## Риски", "");
    for (const risk of report.risks) {
      if (risk.trim()) lines.push(`- ${risk.trim()}`);
    }
    lines.push("");
  }

  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

/** Hidden r7.task payload from doc-compare — not a user-facing deliverable card. */
export function isCompareReportPayloadTask(task: R7Task): boolean {
  if (task.type !== "deliver_inline") return false;
  const data = task.data;
  const { fileName, mimeType, content } = data;
  if (mimeType?.includes("json")) return true;
  if (/compare[-_]?report\.json$/i.test(fileName ?? "")) return true;
  if (typeof content === "string" && /"schema"\s*:\s*"doc-compare\/v1"/.test(content)) {
    return true;
  }
  return false;
}

/** Tasks for export UI — excludes compare-report JSON carrier. */
export function filterExportUiTasks(tasks: R7Task[]): R7Task[] {
  return tasks.filter((t) => !isCompareReportPayloadTask(t));
}

/** Extract CompareReport from assistant message and adjacent tool payloads. */
export function extractCompareReportFromMessage(
  message: HistoryMessage,
  context: HistoryMessage[] = [],
): CompareReport | null {
  const sources = [message, ...context];
  let best: CompareReport | null = null;

  for (const src of sources) {
    for (const candidate of collectCompareReportCandidates(src)) {
      if (!isCompareReport(candidate)) continue;
      if (!best || scoreCompareReport(candidate) > scoreCompareReport(best)) {
        best = candidate;
      }
    }
    for (const candidate of collectCompareReportFromR7Tasks(src)) {
      if (!isCompareReport(candidate)) continue;
      if (!best || scoreCompareReport(candidate) > scoreCompareReport(best)) {
        best = candidate;
      }
    }
  }

  return best;
}

/** Nearby tool/assistant messages in the same turn (between user messages). */
export function getCompareReportContext(
  items: HistoryMessage[],
  index: number,
): HistoryMessage[] {
  const ctx: HistoryMessage[] = [];
  for (let j = index - 1; j >= 0; j--) {
    const item = items[j];
    if (item.role === "user") break;
    if (item.role === "tool" || item.role === "assistant") ctx.push(item);
  }
  for (let j = index + 1; j < items.length; j++) {
    const item = items[j];
    if (item.role === "user") break;
    if (item.role === "tool") ctx.push(item);
  }
  return ctx;
}

function scoreCompareReport(report: CompareReport): number {
  let score = 0;
  if (report.schema === "doc-compare/v1") score += 100;
  for (const section of report.sections ?? []) {
    for (const table of section.tables ?? []) {
      score += table.rows?.length ?? 0;
    }
  }
  if (report.summaryTable?.rows?.length) score += report.summaryTable.rows.length;
  return score;
}

function tableToMarkdown(table: CompareTable): string {
  const headers = table.headers ?? [];
  const rows = table.rows ?? [];
  if (!headers.length && !rows.length) return "";
  const hdr = headers.length ? headers : rows[0] ?? [];
  const body = headers.length ? rows : rows.slice(1);
  if (!hdr.length) return "";

  const escape = (cell: string) => cell.replace(/\|/g, "\\|");
  const lines = [
    `| ${hdr.map(escape).join(" | ")} |`,
    `| ${hdr.map(() => "---").join(" | ")} |`,
    ...body.map((row) => `| ${row.map((c) => escape(String(c))).join(" | ")} |`),
  ];
  return lines.join("\n");
}

function collectCompareReportCandidates(message: HistoryMessage): unknown[] {
  const out: unknown[] = [];

  const pushParsed = (raw: unknown): void => {
    if (raw == null) return;
    if (typeof raw === "string") {
      for (const parsed of parseJsonFragments(raw)) {
        out.push(parsed);
        unwrapNestedReport(parsed, out);
      }
      return;
    }
    if (typeof raw === "object") {
      out.push(raw);
      unwrapNestedReport(raw, out);
    }
  };

  pushParsed(message.metadata);
  if (message.metadata && typeof message.metadata === "object") {
    const meta = message.metadata as Record<string, unknown>;
    for (const key of [
      "compareReport",
      "compare_report",
      "docCompare",
      "doc_compare",
      "report",
      "result",
      "output",
    ]) {
      pushParsed(meta[key]);
    }
  }

  pushParsed(message.content);
  for (const item of message.response_timeline ?? []) {
    pushParsed(item.content);
  }
  for (const call of message.tool_calls ?? []) {
    pushParsed(call.result);
    pushParsed(call.arguments);
    pushParsed(call.args);
  }

  return out;
}

function collectCompareReportFromR7Tasks(message: HistoryMessage): unknown[] {
  const out: unknown[] = [];
  for (const task of extractTasksFromReply(message)) {
    if (!isCompareReportPayloadTask(task) || task.type !== "deliver_inline") continue;
    const content = task.data.content;
    if (typeof content !== "string") continue;
    for (const parsed of parseJsonFragments(content)) {
      out.push(parsed);
    }
  }
  return out;
}

function unwrapNestedReport(value: unknown, out: unknown[]): void {
  if (!value || typeof value !== "object" || Array.isArray(value)) return;
  const obj = value as Record<string, unknown>;
  for (const key of ["compareReport", "compare_report", "report", "data", "result", "output"]) {
    const nested = obj[key];
    if (nested && typeof nested === "object") out.push(nested);
    if (typeof nested === "string") {
      for (const parsed of parseJsonFragments(nested)) out.push(parsed);
    }
  }
}

function parseJsonFragments(text: string): unknown[] {
  const trimmed = text.trim();
  if (!trimmed) return [];

  const results: unknown[] = [];
  const direct = tryParseJson(trimmed);
  if (direct != null) results.push(direct);

  const fences = trimmed.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi);
  for (const match of fences) {
    const parsed = tryParseJson(match[1].trim());
    if (parsed != null) results.push(parsed);
  }

  const schemaMatch = trimmed.match(
    /\{[\s\S]*?"schema"\s*:\s*"doc-compare\/v1"[\s\S]*?\}(?=\s*(?:```|$|\n\n))/,
  );
  if (schemaMatch) {
    const parsed = tryParseJson(schemaMatch[0]);
    if (parsed != null) results.push(parsed);
  }

  return results;
}

function tryParseJson(text: string): unknown | null {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

/** Prefer skill JSON; fallback to chat markdown extraction. */
export function resolveInsertContent(
  message: HistoryMessage,
  context: HistoryMessage[],
  chatFallback: string,
): string | undefined {
  const report = extractCompareReportFromMessage(message, context);
  if (report) {
    const md = compareReportToMarkdown(report);
    const hasTable = /\n\|.+\|/m.test(md);
    const hasChatMd = Boolean(
      report.chatMarkdown?.trim() || report.chat_markdown?.trim(),
    );
    if (md.length >= 40 && (hasTable || hasChatMd)) return md;
  }
  const fallback = chatFallback.trim();
  if (!fallback) return undefined;
  const cleaned = extractReportActionContent(fallback);
  return cleaned || fallback;
}
