/** Markdown → HTML for PasteHtml (tables, headings, quotes, bold). */

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
        `<blockquote style="margin:8px 0;padding:6px 12px;border-left:3px solid #a78bfa;background:#f5f3ff">${inlineFormat(escapeHtml(line.slice(2)))}</blockquote>`,
      );
      i += 1;
      continue;
    }

    if (!line.trim()) {
      i += 1;
      continue;
    }

    parts.push(`<p>${inlineFormat(escapeHtml(line))}</p>`);
    i += 1;
  }

  return parts.join("\n");
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

function buildTableHtml(lines: string[]): string {
  const parseRow = (line: string): string[] =>
    line
      .trim()
      .replace(/^\|/, "")
      .replace(/\|$/, "")
      .split("|")
      .map((c) => c.trim());

  const thStyle =
    "border:1px solid #c4b5fd;padding:6px 8px;background:#ede9fe;font-weight:600;text-align:left";
  const tdStyle = "border:1px solid #c4b5fd;padding:6px 8px;text-align:left";

  const headerCells = parseRow(lines[0]);
  let html =
    '<table style="border-collapse:collapse;width:100%;margin:8px 0;font-size:12px"><thead><tr>';
  for (const cell of headerCells) {
    html += `<th style="${thStyle}">${inlineFormat(escapeHtml(cell))}</th>`;
  }
  html += "</tr></thead><tbody>";

  for (let r = 2; r < lines.length; r++) {
    const cells = parseRow(lines[r]);
    html += "<tr>";
    for (const cell of cells) {
      html += `<td style="${tdStyle}">${inlineFormat(escapeHtml(cell))}</td>`;
    }
    html += "</tr>";
  }

  html += "</tbody></table>";
  return html;
}

function inlineFormat(safeHtml: string): string {
  return safeHtml
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
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
