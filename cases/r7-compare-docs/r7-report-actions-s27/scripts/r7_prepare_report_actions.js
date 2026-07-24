async function handler(state, params) {
  const input = normalizeInput(params);
  if (!input.ok) {
    return { ok: false, error: input.error };
  }

  const tasks = [];
  if (input.mode === "insert" || input.mode === "both") {
    tasks.push({
      type: "paste_text",
      data: input.markdown
    });
  }

  if (input.mode === "download_md" || input.mode === "both") {
    tasks.push({
      type: "deliver_inline",
      data: {
        fileName: input.fileName,
        mimeType: "text/markdown",
        encoding: "utf8",
        content: input.markdown,
        actions: ["download", "paste_text"]
      }
    });
  }

  if (input.mode === "download_html") {
    tasks.push({
      type: "deliver_inline",
      data: {
        fileName: input.htmlFileName,
        mimeType: "text/html",
        encoding: "utf8",
        content: input.htmlContent,
        actions: ["download", "paste"]
      }
    });
  }

  return {
    ok: true,
    mode: input.mode,
    fileName: input.fileName,
    r7_task: tasks,
    r7_task_block: "```r7.task\n" + JSON.stringify(tasks, null, 2) + "\n```",
    agent_message:
      "Вставь в ответ пользователю r7_task_block без изменений. " +
      "Не добавляй служебный JSON в видимую часть."
  };
}

function normalizeInput(params) {
  const raw = params && typeof params === "object" ? params : {};
  const markdown = typeof raw.markdown === "string" ? raw.markdown.trim() : "";
  const mode = typeof raw.mode === "string" ? raw.mode.trim() : "";
  const fileNameRaw = typeof raw.fileName === "string" ? raw.fileName.trim() : "";

  if (!markdown) {
    return { ok: false, error: "Поле markdown обязательно и не должно быть пустым." };
  }
  if (markdown.length > 32768) {
    return {
      ok: false,
      error: "Markdown слишком большой для deliver_inline (> 32768). Используйте docx flow."
    };
  }
  if (!["insert", "download_md", "both", "download_html"].includes(mode)) {
    return {
      ok: false,
      error: "mode должен быть одним из: insert, download_md, both, download_html."
    };
  }

  const fileName = sanitizeMdFileName(fileNameRaw || "compare-report.md");
  const htmlFileName = sanitizeHtmlFileName(fileNameRaw || "compare-report.html");
  const htmlContent = markdownToHtmlDocument(markdown, htmlFileName);
  return { ok: true, markdown, mode, fileName, htmlFileName, htmlContent };
}

function sanitizeMdFileName(name) {
  const value = String(name || "").trim() || "compare-report.md";
  return value.toLowerCase().endsWith(".md") ? value : value + ".md";
}

function sanitizeHtmlFileName(name) {
  const base = String(name || "")
    .trim()
    .replace(/\.md$/i, "")
    .replace(/\.html$/i, "");
  const value = base || "compare-report";
  return value.toLowerCase().endsWith(".html") ? value : value + ".html";
}

function escapeHtml(text) {
  return String(text || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function inlineFormat(text) {
  return escapeHtml(text)
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/`([^`]+)`/g, "<code>$1</code>");
}

function markdownToHtmlDocument(markdown, title) {
  const lines = String(markdown || "").split(/\r?\n/);
  const bodyParts = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    const heading = line.match(/^(#{1,3})\s+(.+)$/);
    if (heading) {
      const level = heading[1].length;
      bodyParts.push("<h" + level + ">" + inlineFormat(heading[2].trim()) + "</h" + level + ">");
      i += 1;
      continue;
    }

    if (/^\s*\|.+\|\s*$/.test(line) && i + 1 < lines.length && /^\s*\|[-:\s|]+\|\s*$/.test(lines[i + 1])) {
      const tableHtml = parseMarkdownTable(lines, i);
      if (tableHtml) {
        bodyParts.push(tableHtml.html);
        i = tableHtml.endIndex;
        continue;
      }
    }

    const bullet = line.match(/^\s*[-*•]\s+(.+)$/);
    if (bullet) {
      const items = [];
      while (i < lines.length) {
        const m = lines[i].match(/^\s*[-*•]\s+(.+)$/);
        if (!m) break;
        items.push("<li>" + inlineFormat(m[1].trim()) + "</li>");
        i += 1;
      }
      bodyParts.push("<ul>" + items.join("") + "</ul>");
      continue;
    }

    if (line.trim()) {
      bodyParts.push("<p>" + inlineFormat(line.trim()) + "</p>");
    }
    i += 1;
  }

  const body = bodyParts.join("\n");
  const safeTitle = escapeHtml(title.replace(/\.html$/i, ""));
  return (
    "<!DOCTYPE html><html><head><meta charset=\"utf-8\"><title>" +
    safeTitle +
    "</title><style>body{font-family:Calibri,Arial,sans-serif;line-height:1.4;margin:24px;}table{border-collapse:collapse;width:100%;margin:12px 0;}th,td{border:1px solid #cbd5e1;padding:6px 8px;vertical-align:top;}th{background:#e8ecf0;}</style></head><body>" +
    body +
    "</body></html>"
  );
}

function parseMarkdownTable(lines, start) {
  if (!/^\s*\|.+\|\s*$/.test(lines[start])) return null;
  if (start + 1 >= lines.length || !/^\s*\|[-:\s|]+\|\s*$/.test(lines[start + 1])) return null;

  function splitRow(line) {
    return line
      .trim()
      .replace(/^\|/, "")
      .replace(/\|$/, "")
      .split("|")
      .map(function (cell) {
        return inlineFormat(cell.trim());
      });
  }

  const headers = splitRow(lines[start]);
  const rows = [];
  let i = start + 2;
  while (i < lines.length && /^\s*\|.+\|\s*$/.test(lines[i])) {
    rows.push(splitRow(lines[i]));
    i += 1;
  }

  let html =
    "<table><thead><tr>" + headers.map(function (h) { return "<th>" + h + "</th>"; }).join("") + "</tr></thead><tbody>";
  for (let r = 0; r < rows.length; r++) {
    html += "<tr>" + rows[r].map(function (c) { return "<td>" + c + "</td>"; }).join("") + "</tr>";
  }
  html += "</tbody></table>";
  return { html: html, endIndex: i };
}
