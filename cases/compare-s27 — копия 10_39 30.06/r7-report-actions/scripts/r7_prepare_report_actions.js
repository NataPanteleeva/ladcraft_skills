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
  if (!["insert", "download_md", "both"].includes(mode)) {
    return {
      ok: false,
      error: "mode должен быть одним из: insert, download_md, both."
    };
  }

  const fileName = sanitizeFileName(fileNameRaw || "compare-report.md");
  return { ok: true, markdown, mode, fileName };
}

function sanitizeFileName(name) {
  const value = String(name || "").trim() || "compare-report.md";
  return value.toLowerCase().endsWith(".md") ? value : value + ".md";
}
