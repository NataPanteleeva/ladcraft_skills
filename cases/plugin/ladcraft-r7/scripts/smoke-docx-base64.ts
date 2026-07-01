/**
 * Smoke tests from ladcraft-r7-docx-base64-plugin-handoff.md §Тест-план.
 * Run: npx tsx scripts/smoke-docx-base64.ts
 */
import { extractDocxFromToolCalls } from "../src/apply/docx-from-tools";
import { sanitizeAssistantChatText, appendToolWebHints, stripAgentServiceMarkup } from "../src/apply/display-sanitize";
import { resolveMessageActions } from "../src/apply/resolve-actions";
import { isCompareReport } from "../src/apply/compare-report";
import { parseUserActionIntent } from "../src/apply/user-action-intent";
import { isDocxDownloadSource } from "../src/apply/download";
import type { HistoryMessage } from "../src/eai/session";
import {
  appendSnapshotPathSupplement,
  documentBashPath,
} from "../src/transfer/message-payload";
import {
  normalizeTemplateSelection,
  resolveTemplateSelection,
} from "../src/transfer/template-selection";
import {
  COMPARE_ASSISTANT_WAIT_MS,
  DEFAULT_ASSISTANT_WAIT_MS,
  extractVisibleText,
  isAssistantInProgress,
  isAssistantReplyReady,
  isAssistantTurnStalled,
  isCompareTurnRequest,
  isRenderableAssistantText,
  resolveAssistantWaitTimeoutMs,
  shouldSuppressStallFallback,
} from "../src/eai/session";
import {
  extractReportActionContent,
  isCompareFailureAck,
  isTemplatePickerMessage,
} from "../src/apply/content-extract";
import { historyToChatMessages } from "../src/ui/chat-history";
import { stripUserMessageSupplements } from "../src/utils/message-text";
import { markdownToHtml } from "../src/markdown/html";

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(`FAIL: ${message}`);
}

function ok(message: string): void {
  console.log(`OK: ${message}`);
}

function downloadBlockOnUser(
  messages: ReturnType<typeof historyToChatMessages>,
  userText = "скачать",
) {
  const userMsg = messages.find((m) => m.role === "user" && m.text.includes(userText));
  return userMsg?.actionPlan?.blocks.find((b) => b.kind === "download");
}

function insertBlockOnUser(
  messages: ReturnType<typeof historyToChatMessages>,
  userText = "вставить",
) {
  const userMsg = messages.find((m) => m.role === "user" && m.text.includes(userText));
  return userMsg?.actionPlan?.blocks.find((b) => b.kind === "insert");
}

const REPORT_TEXT =
  "# Сравнение: ТТ_десктоп\n\nСравнение завершено. Расхождений: 2\n\n" +
  "| пункт | шаблон | документ |\n|-------|--------|----------|\n| 1 | a | b |\n".repeat(
    20,
  );

const DOCX_BASE64 = "UEsDBBQAAAAIAAAA".padEnd(24, "A");

function makeExportMessage(id: string, ackText: string): HistoryMessage {
  return {
    id,
    role: "assistant",
    content: ackText,
    tool_calls: [
      {
        name: "r7_render_and_deliver_docx",
        result: JSON.stringify({
          ok: true,
          delivery: "inline_base64",
          content_base64: DOCX_BASE64,
          fileName: "сравнение_ТТ_десктоп.docx",
          mimeType:
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        }),
      },
    ],
  };
}

function baseHistory(): HistoryMessage[] {
  return [
    { id: "greet", role: "assistant", content: "Здравствуйте! Готов к сравнению документов." },
    { id: "u-template", role: "user", content: "шаблон ТТ_десктоп" },
    { id: "report", role: "assistant", content: REPORT_TEXT },
  ];
}

// #1 — greeting, template, compare: report visible, no buttons
{
  const items = baseHistory();
  const messages = historyToChatMessages(items, { editorType: "word" });
  assert(messages.some((m) => m.text.includes("Здравствуйте")), "greeting visible");
  assert(messages.some((m) => m.role === "user"), "user messages visible");
  const report = messages.find((m) => m.text.includes("Сравнение завершено"));
  assert(Boolean(report), "compare report visible");
  assert(!report?.actionPlan?.blocks.length, "no action buttons before intent");
  ok("1. greeting → template → compare: report visible, no buttons");
}

// #2 — «скачать» after report: .md/.html on user bubble (no docx yet)
{
  const items = [...baseHistory(), { id: "u-dl", role: "user", content: "скачать" }];
  const messages = historyToChatMessages(items, { editorType: "word" });
  const report = messages.find((m) => m.text.includes("Сравнение завершено"));
  const download = downloadBlockOnUser(messages);
  assert(!report?.actionPlan?.blocks.length, "no buttons on report bubble");
  assert(Boolean(download), "markdown download block on user message after intent");
  assert(
    !(
      download &&
      "docxPayload" in download &&
      download.docxPayload
    ),
    "no docx button before export is ready",
  );
  ok("2. «скачать» after report: .md/.html download on user bubble");
}

// #3 — «скачать docx»: export ack visible
{
  const items = [
    ...baseHistory(),
    { id: "u-dl", role: "user", content: "скачать" },
    { id: "u-docx", role: "user", content: "скачать docx" },
    makeExportMessage("export", "DOCX готов к скачиванию."),
  ];
  const messages = historyToChatMessages(items, { editorType: "word" });
  assert(messages.some((m) => m.text.includes("DOCX готов")), "export ack visible");
  ok("3. «скачать docx»: export ack visible in chat");
}

// #4 — «скачать» under export: docx button
{
  const items = [
    ...baseHistory(),
    { id: "u-dl", role: "user", content: "скачать" },
    { id: "u-docx", role: "user", content: "скачать docx" },
    makeExportMessage("export", "DOCX готов к скачиванию."),
    { id: "u-dl2", role: "user", content: "скачать" },
  ];
  const messages = historyToChatMessages(items, { editorType: "word" });
  const exportMsg = messages.find((m) => m.text.includes("DOCX готов"));
  assert(Boolean(exportMsg), "export message still visible");
  const download = exportMsg?.actionPlan?.blocks.find((b) => b.kind === "download");
  assert(Boolean(download), "download block on export message");
  assert(
    Boolean(download && "docxPayload" in download && download.docxPayload),
    "docxPayload present",
  );
  assert(
    Boolean(
      download &&
        "docxPayload" in download &&
        download.docxPayload &&
        isDocxDownloadSource(download.docxPayload),
    ),
    "docxPayload is docx source",
  );
  const report = messages.find((m) => m.text.includes("Сравнение завершено"));
  const reportDownload = downloadBlockOnUser(messages);
  assert(!report?.actionPlan?.blocks.length, "no buttons on report bubble");
  if (reportDownload) {
    assert(
      !(
        "docxPayload" in reportDownload &&
        reportDownload.docxPayload
      ),
      "report download stays markdown-only when docx is on export bubble",
    );
  }
  ok("4. «скачать» under export: docx block on export bubble");
}

// carrier deliver_inline bubble: no raw JSON, no download buttons
{
  const taskBlock = `\`\`\`r7.task\n[{"type":"deliver_inline","data":{"fileName":"compare-report.json","mimeType":"application/json","content":"{\\"schema\\":\\"doc-compare/v1\\"}"}}]\n\`\`\``;
  const items = [
    ...baseHistory(),
    {
      id: "carrier",
      role: "assistant",
      content: taskBlock,
    },
    { id: "u-dl", role: "user", content: "скачать" },
  ];
  const messages = historyToChatMessages(items, { editorType: "word" });
  const carrier = messages.find((m) => m.id === "carrier");
  assert(!carrier, "payload-only carrier hidden from chat");
  const report = messages.find((m) => m.text.includes("Сравнение завершено"));
  const reportDownload = downloadBlockOnUser(messages);
  assert(!report?.actionPlan?.blocks.length, "no buttons on report bubble");
  assert(Boolean(reportDownload), "markdown download on user after «скачать»");
  assert(
    !(
      reportDownload &&
      "docxPayload" in reportDownload &&
      reportDownload.docxPayload
    ),
    "carrier path: no docx on report bubble",
  );
  ok("carrier bubble: no leaked JSON, markdown download on report");
}

// sanitize hides r7.task and content_base64 from display text
{
  const dirty =
    "DOCX готов.\n" +
    JSON.stringify({ content_base64: "A".repeat(200), fileName: "x.docx" }) +
    "\n```r7.task\n[]\n```";
  const clean = sanitizeAssistantChatText(dirty);
  assert(clean === "DOCX готов.", "tool JSON and base64 stripped");
  assert(!clean.includes("content_base64"), "no base64 key in chat");
  ok("display sanitize: hide tool JSON and base64");
}

// sanitize hides doc-compare/v1 JSON fence after markdown report
{
  const dirty =
    "# Ключевые расхождения\n\n1. Пункт один\n\n" +
    '```json\n{"schema":"doc-compare/v1","template":{"name":"T"},"summary":{"total":29},"differences":[]}\n```\n\n' +
    "---\n\n**Расхождений: 29**";
  const clean = sanitizeAssistantChatText(dirty);
  assert(clean.includes("Ключевые расхождения"), "markdown report kept");
  assert(clean.includes("Расхождений: 29"), "summary kept");
  assert(!clean.includes("doc-compare/v1"), "compare JSON stripped");
  assert(!clean.includes("```json"), "json fence stripped");
  ok("display sanitize: hide doc-compare JSON fence");
}

// after tools complete, wait for text — do not mark stalled until API status is terminal
{
  const midTurn: HistoryMessage = {
    id: "a1",
    role: "assistant",
    content: "",
    tool_calls: [
      { name: "bash", status: "completed", result: "ok" },
      { name: "skills", status: "completed", result: { success: true } },
    ],
  };
  assert(isAssistantInProgress(midTurn), "tools done, no text yet → still in progress");
  assert(!isAssistantTurnStalled(midTurn), "not stalled before terminal status");

  const deadTurn: HistoryMessage = {
    ...midTurn,
    status: "completed",
  };
  assert(!isAssistantInProgress(deadTurn), "terminal empty turn → not in progress");
  assert(isAssistantTurnStalled(deadTurn), "terminal empty turn → stalled");
  ok("turn readiness: wait for text after tools, stall only when terminal");
}

// substantive gate: interim compare ack is not ready; full report is ready
{
  const interimOnly: HistoryMessage = {
    id: "interim",
    role: "assistant",
    status: "completed",
    content: "Сравню шаблон и документ B по первым фрагментам.",
    response_timeline: [
      {
        kind: "text",
        content: "Сравню шаблон и документ B по первым фрагментам.",
      },
    ],
  };
  assert(!isRenderableAssistantText("Сравню шаблон и документ B по первым фрагментам."), "interim not renderable");
  assert(!isAssistantReplyReady(interimOnly), "interim-only turn not ready");

  const contentLag: HistoryMessage = {
    id: "lag",
    role: "assistant",
    status: "completed",
    content:
      "Сравнение по первым фрагментам.\n\n**Резюме:** …\n\n**Расхождений: 7**",
    response_timeline: [
      {
        kind: "text",
        content: "Сравню шаблон и документ B по первым фрагментам.",
      },
    ],
  };
  assert(
    extractVisibleText(contentLag).includes("Расхождений: 7"),
    "extractVisibleText prefers substantive content over short timeline",
  );
  assert(isAssistantReplyReady(contentLag), "ready when content has report before timeline catches up");

  const fullReport: HistoryMessage = {
    id: "report",
    role: "assistant",
    status: "completed",
    content: "Сравнение завершено.\n\n| Тип | Расхождение |\n|---|---|\n| Δ | x |\n\n**Расхождений: 2**",
    response_timeline: [
      { kind: "text", content: "Сравню шаблон и документ B по первым фрагментам." },
      { kind: "text", content: "Сравнение завершено.\n\n**Расхождений: 2**" },
    ],
  };
  assert(isAssistantReplyReady(fullReport), "full report in timeline is ready");

  const vfsError =
    "К сожалению, файл snapshot (`r7-word_7D0D6ED6AD3CEAA93810CA4242AC605F9E5C8388_114.json`) недоступен — директория `/session/r7/` пуста, файл не читается.";
  assert(isCompareFailureAck(vfsError), "VFS unavailable ack is compare failure");
  assert(!isRenderableAssistantText(vfsError), "VFS error is not renderable-ready");

  const withReasoning: HistoryMessage = {
    id: "reason",
    role: "assistant",
    status: "completed",
    response_timeline: [
      { kind: "reasoning", content: "Let me analyze the template list first." },
      { kind: "text", content: "Какой шаблон сравнивать с документом B?" },
    ],
  };
  assert(!extractVisibleText(withReasoning).includes("analyze"), "reasoning not in visible text");

  const nazvanieTable =
    "| № | Название | Размер |\n|---|---|---:|\n| 1 | dogovor_postavki.md | 913 |\n| 2 | ТТ_десктоп.md | 162480 |\n\nКакой шаблон сравнивать?";
  assert(isTemplatePickerMessage(nazvanieTable), "| Название | table is template picker");

  const templateDump = "| ***№ п/п** | ***Параметр** | ***Требования** |\n".repeat(15);
  const leakyMsg: HistoryMessage = {
    id: "leak",
    role: "assistant",
    status: "completed",
    content: templateDump,
    response_timeline: [{ kind: "text", content: "Сравню шаблон." }],
  };
  assert(
    extractVisibleText(leakyMsg) === "Сравню шаблон.",
    "template body dump in content not merged into visible text",
  );

  ok("substantive gate: interim wait, content merge, no reasoning in visible");
}

// phase 1: compare turn gets extended timeout; stall fallback suppressed during compare
{
  const templateTableHistory: HistoryMessage[] = [
    { id: "u1", role: "user", content: "привет" },
    {
      id: "a1",
      role: "assistant",
      content:
        "Привет! Укажите номер шаблона.\n\n" +
        "| № | Шаблон | Размер |\n| --- | --- | --- |\n" +
        "| 1 | `dogovor_postavki.md` | 0.9 KB |\n" +
        "| 2 | `ТТ_графика.md` | 28.7 KB |\n" +
        "| 3 | `ТТ_десктоп.md` | 158.7 KB |\n" +
        "| 4 | `ТТ_сервер.md` | 271.6 KB |",
    },
  ];

  assert(isCompareTurnRequest("dogovor_postavki.md", templateTableHistory), "template .md is compare turn");
  assert(
    isCompareTurnRequest("ТТ_десктоп", templateTableHistory),
    "template stem without .md is compare turn",
  );
  assert(
    isCompareTurnRequest("3", templateTableHistory),
    "row number is compare turn",
  );
  assert(
    isCompareTurnRequest("№2", templateTableHistory),
    "№N row is compare turn",
  );
  assert(
    !isCompareTurnRequest("привет", templateTableHistory),
    "greeting is not compare turn",
  );
  assert(
    !isCompareTurnRequest("unknown_template", templateTableHistory),
    "unknown name is not compare turn",
  );
  assert(
    resolveTemplateSelection("ТТ_десктоп", templateTableHistory).canonicalMd === "ТТ_десктоп.md",
    "resolve stem → canonical .md",
  );
  assert(
    normalizeTemplateSelection("ТТ_десктоп", templateTableHistory) === "ТТ_десктоп.md",
    "normalize outbound to .md",
  );
  assert(
    resolveTemplateSelection("3", templateTableHistory).canonicalMd === "ТТ_десктоп.md",
    "row 3 maps to third template",
  );
  assert(
    resolveAssistantWaitTimeoutMs("ТТ_десктоп", templateTableHistory) === COMPARE_ASSISTANT_WAIT_MS,
    "compare timeout 10 min for stem",
  );
  assert(
    resolveAssistantWaitTimeoutMs("привет", templateTableHistory) === DEFAULT_ASSISTANT_WAIT_MS,
    "greeting timeout 5 min",
  );

  const bashPath = documentBashPath("r7-word_smoketest.json");
  const compareContent = appendSnapshotPathSupplement(
    normalizeTemplateSelection("ТТ_десктоп", templateTableHistory),
    bashPath,
  );
  assert(compareContent.includes("[Контекст R7: snapshot path]"), "compare content has path block");
  assert(
    compareContent.includes(`session_file: ${bashPath}`),
    "compare content session_file matches documentBashPath",
  );
  assert(
    compareContent.startsWith("ТТ_десктоп.md"),
    "compare content starts with canonical template name",
  );

  const docxTableHistory: HistoryMessage[] = [
    { id: "u-docx", role: "user", content: "дай шаблоны" },
    {
      id: "a-docx",
      role: "assistant",
      content:
        "**Шаблоны в папке templates:**\n\n" +
        "| # | Имя шаблона | Размер |\n|---|-----------|--------|\n" +
        "| 1 | ТТ_графика.docx | 34 КБ |\n" +
        "| 2 | ТТ_десктоп.docx | 73 КБ |\n" +
        "| 3 | ТТ_сервер.docx | 110 КБ |\n" +
        "| 4 | sub_roznich.docx | 46 КБ |\n\n" +
        "Напишите номер или имя шаблона",
      response_timeline: [
        {
          kind: "reasoning",
          content:
            "2. `r7_list_disk_templates` with `host_document_id: 136, host_file_name: \"doc.docx\"`",
        },
        {
          kind: "text",
          content:
            "**Шаблоны в папке templates:**\n\n" +
            "| # | Имя шаблона | Размер |\n|---|-----------|--------|\n" +
            "| 1 | ТТ_графика.docx | 34 КБ |\n" +
            "| 2 | ТТ_десктоп.docx | 73 КБ |",
        },
      ],
    },
  ];

  assert(isCompareTurnRequest("2", docxTableHistory), "docx table: row number is compare turn");
  assert(
    resolveTemplateSelection("ТТ_десктоп.docx", docxTableHistory).canonicalMd === "ТТ_десктоп.docx",
    "docx table: resolve by file name",
  );
  assert(
    normalizeTemplateSelection("2", docxTableHistory) === "ТТ_десктоп.docx",
    "docx table: normalize row 2 to canonical docx",
  );

  const compareHistory = [
    { id: "u", role: "user" as const, content: "dogovor.md" },
    {
      id: "a",
      role: "assistant" as const,
      content: "Сейчас проведу сравнение документов с шаблоном.",
    },
  ];
  const afterCompareTools: HistoryMessage = {
    id: "a2",
    role: "assistant",
    content: "",
    tool_calls: [
      {
        name: "bash",
        status: "completed",
        arguments: { command: "head -c 150000 /session/r7/foo.json" },
      },
      {
        name: "bash",
        status: "completed",
        arguments: { command: "head -c 200000 /workspace/Templates/bar.md" },
      },
    ],
  };
  assert(
    shouldSuppressStallFallback(compareHistory, afterCompareTools),
    "no 120s stall fallback after compare head tools",
  );
  assert(isAssistantInProgress(afterCompareTools), "still in progress until report text");
  ok("phase 1: compare timeout + suppress stall fallback");
}

// «скачать» + in-progress ack + docx export: buttons only on export
{
  const items = [
    ...baseHistory(),
    { id: "u-dl", role: "user", content: "скачать" },
    { id: "progress", role: "assistant", content: "", status: "running" },
    makeExportMessage("export", "DOCX готов. Нажмите Скачать .docx под этим сообщением."),
  ];
  const messages = historyToChatMessages(items, { editorType: "word" });
  const report = messages.find((m) => m.text.includes("Сравнение завершено"));
  const exportMsg = messages.find((m) => m.text.includes("DOCX готов"));
  const reportDownload = downloadBlockOnUser(messages);
  assert(!report?.actionPlan?.blocks.length, "no buttons on report bubble");
  assert(Boolean(reportDownload), "user has markdown download after «скачать»");
  assert(Boolean(exportMsg?.actionPlan?.blocks.some((b) => b.kind === "download")), "export has download after docx");
  ok("«скачать» → in-progress → docx: markdown on user bubble, docx on export");
}

// docx export path: report without download after export exists
{
  const items = [
    ...baseHistory(),
    { id: "u-dl", role: "user", content: "скачать" },
    { id: "u-docx", role: "user", content: "сохранить в ворд" },
    makeExportMessage("export", "DOCX готов. Нажмите Скачать .docx под этим сообщением."),
    { id: "u-dl2", role: "user", content: "скачать" },
  ];
  const messages = historyToChatMessages(items, { editorType: "word" });
  const report = messages.find((m) => m.text.includes("Сравнение завершено"));
  const exportMsg = messages.find((m) => m.text.includes("DOCX готов"));
  assert(!report?.actionPlan?.blocks.length, "no buttons on report bubble");
  const userDownload = downloadBlockOnUser(messages);
  if (userDownload) {
    assert(
      !(
        "docxPayload" in userDownload &&
        userDownload.docxPayload
      ),
      "user markdown download stays without docx when export exists",
    );
  }
  const download = exportMsg?.actionPlan?.blocks.find((b) => b.kind === "download");
  assert(Boolean(download && "docxPayload" in download && download.docxPayload), "docx on export");
  ok("docx ready: docx block on export bubble");
}

// #6 — insert regression: «вставить» still works from report
{
  const items = [...baseHistory(), { id: "u-ins", role: "user", content: "вставить" }];
  const messages = historyToChatMessages(items, { editorType: "word" });
  const report = messages.find((m) => m.text.includes("Сравнение завершено"));
  assert(!report?.actionPlan?.blocks.length, "no insert on report bubble");
  assert(Boolean(insertBlockOnUser(messages)), "insert block on user message after intent");
  ok("6. «вставить»: insert block from compare report");
}

// extractDocxFromToolCalls — no throw on bad JSON, VFS priority
{
  const good = extractDocxFromToolCalls(makeExportMessage("x", ""));
  assert(Boolean(good?.fileName.endsWith(".docx")), "extracts inline docx");
  const bad = extractDocxFromToolCalls({
    id: "bad",
    role: "assistant",
    tool_calls: [{ name: "r7_render_and_deliver_docx", result: "{not-json" }],
  });
  assert(bad === null, "bad JSON returns null");
  const vfsOnly = extractDocxFromToolCalls({
    id: "vfs",
    role: "assistant",
    tool_calls: [
      {
        name: "r7_render_and_deliver_docx",
        result: JSON.stringify({
          ok: true,
          delivery: "deliver_file",
          fileId: "abc",
          fileName: "test.docx",
        }),
      },
    ],
  });
  assert(vfsOnly === null, "deliver_file with fileId skipped for inline extract");
  ok("extractDocxFromToolCalls: valid / invalid / VFS skip");
}

// v2 heuristics: plain «Результаты сравнения» anchor (no markdown heading)
{
  const preamble = "Запускаю сравнение документов.\n\n";
  const report =
    "Результаты сравнения:\n\nСравнение завершено. Расхождений: 1\n\n" +
    "| пункт | шаблон | документ |\n|-------|--------|----------|\n| 1 | a | b |\n".repeat(
      15,
    );
  const extracted = extractReportActionContent(preamble + report);
  assert(extracted.includes("Сравнение завершено"), "plain section anchor keeps report body");
  assert(!extracted.includes("Запускаю сравнение"), "preamble stripped");
  ok("content-extract: plain «Результаты сравнения» anchor");
}

// v2 heuristics: «Что дальше:» colon variant truncates tail
{
  const report =
    "# Сравнение завершено\n\n| пункт | шаблон | документ |\n| a | b | c |\n".repeat(20) +
    "\n\nЧто дальше:\n- Вставить в документ\n- Скачать .md";
  const extracted = extractReportActionContent(report);
  assert(extracted.includes("Сравнение завершено"), "report body kept");
  assert(!extracted.includes("Вставить в документ"), "«Что дальше:» tail cut");
  ok("content-extract: «Что дальше:» colon truncates offer tail");
}

// intent-gated insert after «вставить» on plain-results report
{
  const reportText =
    "Результаты сравнения:\n\nСравнение завершено. Расхождений: 2\n\n" +
    "| пункт | шаблон | документ |\n|-------|--------|----------|\n| 1 | a | b |\n".repeat(
      20,
    );
  const items: HistoryMessage[] = [
    { id: "report", role: "assistant", content: reportText },
    { id: "u-ins", role: "user", content: "вставить" },
  ];
  const messages = historyToChatMessages(items, { editorType: "word" });
  const report = messages.find((m) => m.text.includes("Сравнение завершено"));
  assert(!report?.actionPlan?.blocks.length, "no insert on report bubble");
  assert(Boolean(insertBlockOnUser(messages)), "insert block after intent");
  ok("intent-gated insert on plain-results compare report");
}

// regression: «скачать» + agent ack without docx (real chat export 2026-06-29)
{
  const reportText =
    "## Результаты сравнения\n\n**Шаблон:** `dogovor_postavki.md`\n\n" +
    "| Пункт | Шаблон | Документ | Комментарий | Метка |\n|---|---|---|---|---|\n" +
    "| Тип договора | Договор поставки | Сублицензионный | Разные конструкции | ⚠️ Расхождение |\n".repeat(
      12,
    ) +
    "\n\n**Расхождений: 11**\n\n" +
    "Чтобы вставить отчёт в документ, напишите: **вставить**\n" +
    "Чтобы скачать отчёт, напишите: **скачать**";
  const items: HistoryMessage[] = [
    { id: "report", role: "assistant", content: reportText },
    { id: "u-dl", role: "user", content: "скачать" },
    {
      id: "ack",
      role: "assistant",
      content:
        "Отчёт готов! Файл сохранён. Нажмите кнопку загрузки или скопируйте текст выше.",
    },
  ];
  const messages = historyToChatMessages(items, { editorType: "word" });
  const report = messages.find((m) => m.text.includes("Результаты сравнения"));
  const ack = messages.find((m) => m.text.includes("Отчёт готов"));
  const download = downloadBlockOnUser(messages);
  assert(!report?.actionPlan?.blocks.length, "no buttons on report bubble");
  assert(Boolean(download), "download block on user message after «скачать»");
  assert(!ack?.actionPlan?.blocks.length, "short ack bubble has no duplicate download");
  const payload = download && "payload" in download ? download.payload : undefined;
  const text = payload?.kind === "text" ? payload.text : "";
  assert(text.includes("Расхождений: 11"), "report body in export");
  assert(!text.includes("Чтобы вставить"), "export excludes insert hint");
  assert(!text.includes("Чтобы скачать"), "export excludes download hint");
  ok("regression: markdown download after «скачать» without docx export");
}

// template picker + sub_roznich.md must not trigger download intent or buttons
{
  const templateHistory: HistoryMessage[] = [
    { id: "u1", role: "user", content: "привет" },
    {
      id: "a1",
      role: "assistant",
      content:
        "Шаблоны:\n\n| № | Шаблон | Размер |\n| --- | --- | --- |\n" +
        "| 1 | `dogovor_postavki.md` | 0.9 KB |\n" +
        "| 2 | `sub_roznich.md` | 38 KB |\n\nУкажите номер или имя шаблона.",
    },
    { id: "u2", role: "user", content: "sub_roznich.md" },
  ];
  const intent = parseUserActionIntent("sub_roznich.md", { items: templateHistory });
  assert(!intent.download, "template .md selection is not download intent");
  const messages = historyToChatMessages(templateHistory, { editorType: "word" });
  const picker = messages.find((m) => m.text.includes("Шаблон | Размер"));
  assert(!picker?.actionPlan?.blocks.length, "no buttons on template picker bubble");
  ok("template picker: sub_roznich.md does not show download buttons");
}

// isCompareReport: schema-only stub is rejected
{
  assert(!isCompareReport({ schema: "doc-compare/v1" }), "schema-only stub rejected");
  assert(
    isCompareReport({
      schema: "doc-compare/v1",
      chatMarkdown: "# Отчёт\n\n| a | b |\n|---|---|\n| 1 | 2 |",
    }),
    "chatMarkdown accepted",
  );
  ok("isCompareReport: requires chatMarkdown or tables");
}

// export must not include bash stdout from tool_calls
{
  const contractLeak = "УНИКАЛЬНАЯ_СТРОКА_ИЗ_HEAD_ДОГОВОРА_12345";
  const reportText =
    "## Результаты сравнения\n\n**Расхождений: 3**\n\n" +
    "| Пункт | Шаблон | Документ |\n|---|---|---|\n| 1 | a | b |\n".repeat(20);
  const taskBlock =
    '```r7.task\n[{"type":"deliver_inline","data":{"fileName":"compare-report.json","mimeType":"application/json","content":"{\\"schema\\":\\"doc-compare/v1\\",\\"chatMarkdown\\":\\"# Отчёт\\\\n\\\\n| a | b |\\\\n|---|---|\\\\n| 1 | 2 |\\"}"}}]\n```';
  const items: HistoryMessage[] = [
    {
      id: "report",
      role: "assistant",
      content: reportText + "\n" + taskBlock,
      tool_calls: [
        {
          name: "bash",
          result: `head output\n${contractLeak}\nmore template text`,
        },
      ],
    },
    { id: "u-dl", role: "user", content: "скачать" },
  ];
  const reportIdx = 0;
  const plan = resolveMessageActions(items[reportIdx], {
    editorType: "word",
    items,
    messageIndex: reportIdx,
    userIntent: { insert: false, download: true },
    payloadSourceIndex: reportIdx,
  });
  const download = plan.blocks.find((b) => b.kind === "download");
  assert(Boolean(download), "download block present");
  const payload = download && "payload" in download ? download.payload : undefined;
  const text =
    payload?.kind === "text"
      ? payload.text
      : payload?.kind === "card" && payload.card.kind === "inline"
        ? String(payload.card.content ?? "")
        : "";
  assert(!text.includes(contractLeak), "export text excludes bash stdout");
  ok("export: no bash stdout in download payload");
}

// export must not include orphan ```r7.task tail (unclosed fence)
{
  const reportText =
    "| # | Раздел | Параметр | Шаблон | Документ | Критичность |\n" +
    "| - | - | - | - | - | - |\n" +
    "| 1 | Правообладатель | Наименование | АО «Р7» | АО «Р7-Цифра» | 🔴 |\n".repeat(8) +
    "\n**Расхождений: 9**\n\n" +
    "Критичные расхождения — реквизиты Правообладателя полностью изменены.\n";
  const orphanTask =
    '```r7.task\n},{"title":"Перечень ПО","tables":[{"headers":["Параметр"],"rows":[["x"]]}],"chatMarkdown":"## leak"';
  const items: HistoryMessage[] = [
    {
      id: "report",
      role: "assistant",
      content: reportText + "\n\n" + orphanTask,
    },
    { id: "u-dl", role: "user", content: "скачать" },
  ];
  const plan = resolveMessageActions(items[0], {
    editorType: "word",
    items,
    messageIndex: 0,
    userIntent: { insert: false, download: true },
    payloadSourceIndex: 0,
  });
  const download = plan.blocks.find((b) => b.kind === "download");
  assert(Boolean(download), "download block present");
  const payload = download && "payload" in download ? download.payload : undefined;
  const text = payload?.kind === "text" ? payload.text : "";
  assert(text.includes("Расхождений: 9"), "report body kept");
  assert(!text.includes("```r7.task"), "orphan r7.task fence stripped");
  assert(!text.includes("chatMarkdown"), "task JSON tail stripped");
  ok("export: no orphan r7.task in download payload");
}

// requestDocx flag on report bubble when export not ready
{
  const items = [
    ...baseHistory(),
    { id: "u-dl", role: "user", content: "скачать" },
  ];
  const messages = historyToChatMessages(items, { editorType: "word" });
  const download = downloadBlockOnUser(messages);
  assert(Boolean(download && "requestDocx" in download && download.requestDocx), "requestDocx on user bubble");
  ok("requestDocx: flag set before export is ready");
}

// Chat must not drop messages when resolving actions on export bubble
{
  const items = [
    ...baseHistory(),
    { id: "u-docx", role: "user", content: "скачать docx" },
    makeExportMessage("export", "DOCX готов."),
    { id: "u-dl", role: "user", content: "скачать docx" },
  ];
  const messages = historyToChatMessages(items, { editorType: "word" });
  assert(messages.length >= 5, `expected >=5 chat messages, got ${messages.length}`);
  const reportIdx = items.findIndex((m) => m.id === "report");
  const exportIdx = items.findIndex((m) => m.id === "export");
  const plan = resolveMessageActions(items[exportIdx], {
    editorType: "word",
    items,
    messageIndex: exportIdx,
    userIntent: { insert: false, download: true },
    payloadSourceIndex: reportIdx,
    actionAnchorIndex: exportIdx,
  });
  assert(plan.blocks.some((b) => b.kind === "download"), "resolveMessageActions does not throw");
  ok("chat regression: all messages preserved, resolveMessageActions stable");
}

// user bubble: hide R7 disk supplement from display
{
  const items: HistoryMessage[] = [
    {
      id: "u-disk",
      role: "user",
      content:
        "сохрани на диск\n\n[Контекст R7: диск]\ndocument_id: 113\nfile_name: test.docx",
    },
  ];
  const messages = historyToChatMessages(items, { editorType: "word" });
  assert(messages.length === 1, "one user bubble");
  assert(messages[0].text === "сохрани на диск", "only visible user text");
  assert(
    stripUserMessageSupplements(items[0].content!) === "сохрани на диск",
    "stripUserMessageSupplements",
  );
  ok("user bubble: R7 disk supplement hidden");
}

// assistant: dedupe duplicate disk-save ack lines
{
  const text =
    "Отчёт сохранён на Р7-Диск: **Мои документы / CompareResults / report.docx**\n" +
    "Отчёт сохранён на Р7-Диск: папка «CompareResults», файл «report.docx».";
  const cleaned = sanitizeAssistantChatText(text);
  const matches = cleaned.match(/Отчёт сохранён на Р7-Диск/g) ?? [];
  assert(matches.length === 1, "single ack line");
  assert(cleaned.includes("папка «CompareResults»"), "skill-format ack kept");
  ok("assistant: dedupe disk-save ack");
}

// assistant: web_ui_hint from tool_calls becomes clickable link
{
  const diskUrl = "https://cddisk.example/docs/111";
  const item: HistoryMessage = {
    id: "a-save",
    role: "assistant",
    content:
      "Отчёт сохранён на Р7-Диск: папка «CompareResults», файл «report.docx». Откройте папку в веб-интерфейсе диска.",
    tool_calls: [
      {
        name: "r7_save_compare_report_to_disk",
        result: JSON.stringify({ ok: true, web_ui_hint: diskUrl }),
      },
    ],
  };
  const enriched = appendToolWebHints(item, item.content!);
  assert(enriched.includes(diskUrl), "web_ui_hint appended");
  const html = markdownToHtml(sanitizeAssistantChatText(enriched));
  assert(html.includes(`href="${diskUrl}"`), "autolink href");
  assert(html.includes('class="deliver-link"'), "deliver-link class");
  ok("assistant: web_ui_hint autolink");
}

// assistant: hide MiniMax invoke XML from chat export fixture (2026-06-30)
{
  const interimText =
    "Привет! Запускаю START — активирую навык и получаю список шаблонов.\n\n" +
    '<invoke name="r7_list_disk_templates">\n' +
    '<parameter name="host_document_id">136</parameter>\n' +
    '<parameter name="host_file_name">Сублицензионный в2.docx</parameter>\n' +
    "</invoke>\n</minimax:tool_call>";
  const finalText =
    "Хост-документ: **Сублицензионный в2.docx** (id: 136)\n\n" +
    "**Шаблоны в папке templates:**\n\n" +
    "1. Сублицензионный договор.md — 12 КБ\n\n" +
    "Напишите номер или имя шаблона, чтобы начать сравнение.";
  const item: HistoryMessage = {
    id: "a-templates",
    role: "assistant",
    content: interimText + "\n\n\n\n" + finalText,
    response_timeline: [
      { kind: "reasoning", content: "internal only" },
      { kind: "text", content: interimText },
      { kind: "tool_group", content: "" },
      { kind: "text", content: finalText },
    ],
  };

  const visible = extractVisibleText(item);
  const bubble = sanitizeAssistantChatText(visible);

  assert(!bubble.includes("<invoke"), "no invoke tag");
  assert(!bubble.includes("minimax:tool_call"), "no minimax tool_call tag");
  assert(!bubble.includes("<parameter"), "no parameter tag");
  assert(bubble.includes("Шаблоны в папке templates"), "template list kept");
  assert(bubble.includes("Напишите номер"), "picker prompt kept");
  assert(
    stripAgentServiceMarkup(interimText).includes("Запускаю START"),
    "preamble survives strip",
  );
  ok("assistant: strip MiniMax invoke from template picker bubble");
}

// compare report fallback widget: completed tool call without widget_html still renders actions
{
  const reportText =
    "## Результаты сравнения\n\n" +
    "| Пункт | Шаблон | Документ | Комментарий | Метка |\n|---|---|---|---|---|\n" +
    "| 1 | a | b | c | 🟡 |\n\n" +
    "Расхождений: 1";
  const items: HistoryMessage[] = [
    {
      id: "report-fallback",
      role: "assistant",
      content: reportText,
      tool_calls: [{ name: "r7_show_compare_actions_widget", status: "completed" }],
    },
  ];
  const messages = historyToChatMessages(items, { editorType: "word" });
  const report = messages.find((m) => m.id === "report-fallback");
  assert(Boolean(report?.widget?.html), "fallback widget html attached");
  assert(
    Boolean(report?.widget?.html.includes('data-value="вставить"')),
    "fallback widget contains insert button",
  );
  assert(
    Boolean(report?.widget?.html.includes('data-value="скачать md"')),
    "fallback widget contains download md button",
  );
  assert(
    Boolean(report?.widget?.html.includes('data-value="скачать html"')),
    "fallback widget contains download html button",
  );
  assert(
    Boolean(report?.widget?.html.includes('data-value="сохранить на диск"')),
    "fallback widget contains save-to-disk button",
  );
  ok("compare report: fallback widget rendered when kind:widget missing");
}

console.log("\nAll smoke checks passed.");
