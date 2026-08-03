/**
 * Markdown tables for PasteHtml / chat:
 * short structural tables stay as <table>; prose (long cells) → kv-stack.
 */

const MD_TABLE_ROW = /^\s*\|.+\|\s*$/;
const MD_TABLE_SEP = /^\s*\|[-:\s|]+\|\s*$/;

/** Heuristic: content looks like markdown, not raw HTML. */
export function looksLikeMarkdown(text: string): boolean {
  const sample = text.trim().slice(0, 4000);
  if (!sample) return false;
  if (/^<[a-z][\s\S]*>/i.test(sample) && !sample.includes("|")) return false;
  return (
    /^#{1,6}\s/m.test(sample) ||
    /^\s*\|.+\|\s*$/m.test(sample) ||
    /^\s*>\s/m.test(sample) ||
    /\*\*.+\*\*/.test(sample)
  );
}

/** Convert assistant markdown to HTML suitable for R7 PasteHtml. */
export function markdownToHtml(text: string): string {
  const parts: string[] = [];
  const lines = text.split("\n");
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (MD_TABLE_ROW.test(line) && i + 1 < lines.length && MD_TABLE_SEP.test(lines[i + 1])) {
      const tableLines: string[] = [line];
      i += 1;
      tableLines.push(lines[i]);
      i += 1;
      while (i < lines.length && MD_TABLE_ROW.test(lines[i])) {
        tableLines.push(lines[i]);
        i += 1;
      }
      parts.push(buildTableHtml(tableLines));
      continue;
    }

    const heading = line.match(/^(#{1,6})\s+(.+)$/);
    if (heading) {
      const level = Math.min(heading[1].length, 6);
      parts.push(
        `<h${level}>${inlineFormat(escapeHtml(heading[2]))}</h${level}>`,
      );
      i += 1;
      continue;
    }

    if (line.startsWith("> ")) {
      parts.push(
        `<blockquote style="margin:4px 0;padding:4px 10px;border-left:3px solid #a78bfa;background:#f5f3ff">${inlineFormat(escapeHtml(line.slice(2)))}</blockquote>`,
      );
      i += 1;
      continue;
    }

    if (/^\s*-\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*-\s+/.test(lines[i])) {
        const raw = lines[i].replace(/^\s*-\s+/, "").trim();
        items.push(`<li>${inlineFormat(escapeHtml(raw))}</li>`);
        i += 1;
      }
      parts.push(`<ul>${items.join("")}</ul>`);
      continue;
    }

    if (/^\s*\d+\.\s+/.test(line)) {
      // Section title pattern: "1. Доисторический этап" then blank + prose
      // (not another list item). Render as heading — otherwise each lone
      // `<ol><li>` resets to "1." in the browser / Word.
      let peek = i + 1;
      while (peek < lines.length && !String(lines[peek] || "").trim()) peek += 1;
      const nextLine = peek < lines.length ? lines[peek] : "";
      const titleMatch = line.match(/^\s*(\d+)\.\s+(.+)$/);
      const titleText = titleMatch ? titleMatch[2].trim() : "";
      const loneSection =
        Boolean(titleMatch) &&
        titleText.length > 0 &&
        titleText.length <= 100 &&
        !/^\s*\d+\.\s+/.test(nextLine) &&
        !/^\s*-\s+/.test(nextLine);
      if (loneSection && titleMatch) {
        parts.push(
          `<h3>${escapeHtml(titleMatch[1])}. ${inlineFormat(escapeHtml(titleText))}</h3>`,
        );
        i += 1;
        continue;
      }

      const items: string[] = [];
      let start = 1;
      let first = true;
      while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) {
        const m = lines[i].match(/^\s*(\d+)\.\s+(.+)$/);
        if (!m) break;
        if (first) {
          start = Math.max(1, Number(m[1]) || 1);
          first = false;
        }
        items.push(`<li>${inlineFormat(escapeHtml(m[2].trim()))}</li>`);
        i += 1;
      }
      parts.push(`<ol start="${start}">${items.join("")}</ol>`);
      continue;
    }

    if (!line.trim()) {
      i += 1;
      continue;
    }

    // Merge consecutive text lines into one paragraph (blank line = new block).
    const paraLines: string[] = [];
    while (i < lines.length) {
      const cur = lines[i];
      if (!cur.trim()) break;
      if (MD_TABLE_ROW.test(cur) && i + 1 < lines.length && MD_TABLE_SEP.test(lines[i + 1])) {
        break;
      }
      if (/^#{1,6}\s+/.test(cur) || cur.startsWith("> ") || /^\s*-\s+/.test(cur) || /^\s*\d+\.\s+/.test(cur)) {
        break;
      }
      paraLines.push(cur.replace(/\s+$/, ""));
      i += 1;
    }
    parts.push(
      `<p>${paraLines.map((l) => inlineFormat(escapeHtml(l))).join("<br>")}</p>`,
    );
  }

  // No "\n" between blocks — .message uses pre-wrap and would add visual gaps.
  return parts.join("");
}

/** Normalize text/HTML for PasteHtml. */
export function contentToPasteHtml(content: string, mimeType?: string): string {
  if (mimeType?.includes("html")) return content;
  if (/<[a-z][\s\S]*>/i.test(content) && !looksLikeMarkdown(content)) return content;
  if (looksLikeMarkdown(content) || mimeType?.includes("markdown")) {
    return markdownToHtml(content);
  }
  return `<p>${content.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")}</p>`;
}

export function parseMarkdownTableRow(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((c) => c.trim());
}

function median(nums: number[]): number {
  if (!nums.length) return 0;
  const sorted = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * Long / narrative 2-col tables are unreadable in a narrow plugin panel.
 * Keep short structural tables (proofread №|Ошибка|Правильно, FAQ).
 */
export function isProseMarkdownTable(lines: string[]): boolean {
  if (lines.length < 3) return false;
  const header = parseMarkdownTableRow(lines[0]);
  const headerJoined = header
    .map((c) =>
      String(c || "")
        .replace(/\*/g, "")
        .trim()
        .toLowerCase(),
    )
    .join("|");
  // LCA proofread / typo tables — never demote to cards in chat.
  if (
    /№|no\.?|#/.test(headerJoined) &&
    /ошибк|опечатк|было|search|error/.test(headerJoined) &&
    /правильно|исправлен|стало|replace|fix/.test(headerJoined)
  ) {
    return false;
  }
  if (
    header.length >= 3 &&
    /ошибк|опечатк|было/.test(headerJoined) &&
    /правильно|исправлен|стало/.test(headerJoined)
  ) {
    return false;
  }

  const body: string[][] = [];
  for (let r = 2; r < lines.length; r++) {
    body.push(parseMarkdownTableRow(lines[r]));
  }
  if (!body.length) return false;

  const colCount = Math.max(header.length, ...body.map((r) => r.length));
  const bodyLens = (col: number) =>
    body.map((row) => String(row[col] || "").length).filter((n) => n > 0);

  for (const row of body) {
    for (const cell of row) {
      if (String(cell || "").length >= 80) return true;
    }
  }

  if (colCount === 2) {
    const col1 = bodyLens(1);
    if (col1.length && median(col1) >= 40) return true;
    const col0 = bodyLens(0);
    if (col0.length && Math.max(...col0) >= 24) return true;
  }

  return false;
}

/** Convert GFM table lines to readable markdown list (no pipes). */
export function gfmTableLinesToKvMarkdown(lines: string[]): string {
  if (lines.length < 3) return lines.join("\n");
  const header = parseMarkdownTableRow(lines[0]);
  const parts: string[] = [];
  for (let r = 2; r < lines.length; r++) {
    const cells = parseMarkdownTableRow(lines[r]);
    if (cells.length >= 2) {
      const key = cells[0] || header[0] || "";
      const val = cells.slice(1).join(" — ");
      parts.push(`**${key}.** ${val}`);
    } else if (cells[0]) {
      parts.push(cells[0]);
    }
    parts.push("");
  }
  return parts.join("\n").trim();
}

/** Rewrite prose GFM tables in a markdown blob into kv lists (keep short tables). */
export function demoteProseTablesInMarkdown(md: string): string {
  const lines = String(md || "").split("\n");
  const out: string[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (MD_TABLE_ROW.test(line) && i + 1 < lines.length && MD_TABLE_SEP.test(lines[i + 1])) {
      const tableLines: string[] = [line, lines[i + 1]];
      i += 2;
      while (i < lines.length && MD_TABLE_ROW.test(lines[i])) {
        tableLines.push(lines[i]);
        i += 1;
      }
      if (isProseMarkdownTable(tableLines)) {
        out.push(gfmTableLinesToKvMarkdown(tableLines));
      } else {
        out.push(...tableLines);
      }
      out.push("");
      continue;
    }
    out.push(line);
    i += 1;
  }
  return out.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

/** Force-demote all GFM tables in markdown to kv lists. */
export function demoteAllTablesInMarkdown(md: string): string {
  const lines = String(md || "").split("\n");
  const out: string[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (MD_TABLE_ROW.test(line) && i + 1 < lines.length && MD_TABLE_SEP.test(lines[i + 1])) {
      const tableLines: string[] = [line, lines[i + 1]];
      i += 2;
      while (i < lines.length && MD_TABLE_ROW.test(lines[i])) {
        tableLines.push(lines[i]);
        i += 1;
      }
      out.push(gfmTableLinesToKvMarkdown(tableLines));
      out.push("");
      continue;
    }
    out.push(line);
    i += 1;
  }
  return out.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

function stripMdMarks(text: string): string {
  return String(text || "")
    .replace(/\*\*/g, "")
    .replace(/`/g, "")
    .trim();
}

/** First column: icon glyphs vs short labels (Режим / slug) vs long prose. */
function firstColKind(lines: string[]): "icon" | "label" | "default" {
  const header = parseMarkdownTableRow(lines[0]);
  const bodies = lines.slice(2).map((row) => parseMarkdownTableRow(row)[0] || "");
  const samples = [header[0] || "", ...bodies].map(stripMdMarks);

  const looksIcon = (t: string) =>
    !t || (t.length <= 3 && !/[a-zа-яё]{2,}/i.test(t));

  if (bodies.length && bodies.every((c) => looksIcon(stripMdMarks(c)))) {
    return "icon";
  }

  const maxLen = samples.reduce((m, t) => Math.max(m, t.length), 0);
  // Short/medium labels (Рекомендации, announcement) — keep on one line.
  if (maxLen > 0 && maxLen <= 22) return "label";
  return "default";
}

function buildKvStackHtml(lines: string[]): string {
  const header = parseMarkdownTableRow(lines[0]);
  const keyLabel = header[0] || "";
  const valLabel = header[1] || "";
  const items: string[] = [];
  for (let r = 2; r < lines.length; r++) {
    const cells = parseMarkdownTableRow(lines[r]);
    const key = cells[0] || "";
    const val = cells.slice(1).join(" — ") || "";
    items.push(
      `<div class="md-kv-item"><div class="md-kv-key">${inlineFormat(escapeHtml(key || keyLabel))}</div>` +
        `<div class="md-kv-val">${inlineFormat(escapeHtml(val || valLabel))}</div></div>`,
    );
  }
  return `<div class="md-kv-stack">${items.join("")}</div>`;
}

function isFindingsErrorTable(lines: string[]): boolean {
  const header = parseMarkdownTableRow(lines[0]);
  const headerJoined = header
    .map((c) =>
      String(c || "")
        .replace(/\*/g, "")
        .trim()
        .toLowerCase(),
    )
    .join("|");
  return (
    header.length >= 3 &&
    /№|no\.?|#/.test(headerJoined) &&
    /ошибк|опечатк|было|search|error/.test(headerJoined) &&
    /правильно|исправлен|стало|replace|fix/.test(headerJoined)
  );
}

function buildTableHtml(lines: string[]): string {
  if (isProseMarkdownTable(lines)) {
    return buildKvStackHtml(lines);
  }

  const findings = isFindingsErrorTable(lines);
  const col0 = findings ? "num" : firstColKind(lines);
  const thBase =
    "border:1px solid #c4b5fd;padding:3px 6px;background:#ede9fe;font-weight:600;vertical-align:middle";
  const tdBase =
    "border:1px solid #c4b5fd;padding:3px 6px;vertical-align:top";

  const col0Class =
    col0 === "icon"
      ? "md-col-icon"
      : col0 === "label"
        ? "md-col-label"
        : col0 === "num"
          ? "md-col-num"
          : "";
  const col0ThExtra =
    col0 === "icon"
      ? ";text-align:center;width:2.75em;min-width:2.75em;white-space:nowrap;font-weight:700"
      : col0 === "label"
        ? ";text-align:left;width:1%;white-space:nowrap;word-break:normal;overflow-wrap:normal"
        : col0 === "num"
          ? ";text-align:center;width:2.4em;min-width:2.4em;max-width:2.8em;white-space:nowrap;word-break:normal;overflow-wrap:normal"
          : ";text-align:left;word-break:normal;overflow-wrap:break-word";
  const col0TdExtra =
    col0 === "icon"
      ? ";text-align:center;width:2.75em;min-width:2.75em;white-space:nowrap;font-weight:700;font-size:1.2em;vertical-align:middle"
      : col0 === "label"
        ? ";text-align:left;width:1%;white-space:nowrap;word-break:normal;overflow-wrap:normal;vertical-align:middle"
        : col0 === "num"
          ? ";text-align:center;width:2.4em;min-width:2.4em;max-width:2.8em;white-space:nowrap;word-break:normal;overflow-wrap:normal;vertical-align:middle;font-weight:700"
          : ";text-align:left;word-break:normal;overflow-wrap:break-word";

  // Findings: fixed ratios so «Ошибка» is not crushed by long «Правильно».
  const otherThExtra = findings
    ? ";text-align:left;word-break:normal;overflow-wrap:break-word;hyphens:auto"
    : ";text-align:left;word-break:normal;overflow-wrap:break-word";
  const otherTdExtra = findings
    ? ";text-align:left;word-break:normal;overflow-wrap:break-word;hyphens:auto"
    : ";text-align:left;word-break:normal;overflow-wrap:break-word";

  const headerCells = parseMarkdownTableRow(lines[0]);
  const tableClass = findings ? "md-table md-table-findings" : "md-table";
  const layout = findings ? "fixed" : "auto";
  let html =
    `<table class="${tableClass}" style="border-collapse:collapse;width:100%;margin:1px 0;font-size:13px;table-layout:${layout}"><thead><tr>`;
  if (findings && headerCells.length >= 3) {
    html =
      `<table class="${tableClass}" style="border-collapse:collapse;width:100%;margin:1px 0;font-size:13px;table-layout:fixed">` +
      `<colgroup><col style="width:2.4em"/><col style="width:36%"/><col style="width:auto"/></colgroup><thead><tr>`;
  }
  for (let c = 0; c < headerCells.length; c++) {
    const cell = headerCells[c];
    const cls = c === 0 && col0Class ? ` class="${col0Class}"` : "";
    let style = `${thBase}${c === 0 ? col0ThExtra : otherThExtra}`;
    if (findings && c === 1) style += ";min-width:5.5em;width:36%";
    if (findings && c === 2) style += ";min-width:6em";
    html += `<th${cls} style="${style}">${inlineFormat(escapeHtml(cell))}</th>`;
  }
  html += "</tr></thead><tbody>";

  for (let r = 2; r < lines.length; r++) {
    const cells = parseMarkdownTableRow(lines[r]);
    html += "<tr>";
    for (let c = 0; c < cells.length; c++) {
      const cell = cells[c];
      const cls = c === 0 && col0Class ? ` class="${col0Class}"` : "";
      let style = `${tdBase}${c === 0 ? col0TdExtra : otherTdExtra}`;
      if (findings && c === 1) style += ";min-width:5.5em";
      if (findings && c === 2) style += ";min-width:6em";
      html += `<td${cls} style="${style}">${inlineFormat(escapeHtml(cell))}</td>`;
    }
    html += "</tr>";
  }

  html += "</tbody></table>";
  return `<div class="md-table-wrap">${html}</div>`;
}

function inlineFormat(safeHtml: string): string {
  let out = safeHtml;
  out = out.replace(
    /\[([^\]]+)\]\((#[a-zA-Z0-9_-]+)\)/g,
    (_match, label, hash) => helpLinkHtml(hash, label),
  );
  out = out.replace(
    /\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g,
    (_match, label, url) => linkHtml(url, label),
  );
  out = autolinkBareUrls(out);
  out = out
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  return out;
}

function autolinkBareUrls(text: string): string {
  const re = /https?:\/\/[^\s<"]+/g;
  let result = "";
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = re.exec(text)) !== null) {
    const start = match.index;
    const url = match[0];
    const before = text.slice(0, start);

    if (isInsideAnchor(before, text.slice(start))) {
      result += text.slice(lastIndex, start + url.length);
      lastIndex = start + url.length;
      continue;
    }
    if (/"https?:\/\/[^"]*$/.test(before.slice(-200))) {
      result += text.slice(lastIndex, start + url.length);
      lastIndex = start + url.length;
      continue;
    }

    result += text.slice(lastIndex, start);
    result += linkHtml(url, url);
    lastIndex = start + url.length;
  }

  return result + text.slice(lastIndex);
}

function isInsideAnchor(before: string, after: string): boolean {
  const lastOpen = before.lastIndexOf("<a ");
  const lastClose = before.lastIndexOf("</a>");
  if (lastOpen <= lastClose) return false;
  return !after.includes("</a>");
}

function linkHtml(url: string, label: string): string {
  const safeUrl = escapeAttr(url);
  return `<a href="${safeUrl}" target="_blank" rel="noopener noreferrer" class="deliver-link">${label}</a>`;
}

function helpLinkHtml(hash: string, label: string): string {
  const safeHash = escapeAttr(hash);
  return `<a href="${safeHash}" class="deliver-link r7-help-link">${label}</a>`;
}

function escapeAttr(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;");
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/** Wrap fragment for download as .html (opens in Word). */
export function wrapHtmlDocument(bodyHtml: string, title: string): string {
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title></head>
<body>${bodyHtml}</body></html>`;
}
