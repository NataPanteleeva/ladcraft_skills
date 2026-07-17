/**
 * Smoke: summary without fence → markdown-fallback (full text);
 * with fence → proposal; whole window → missing-proposal.
 * Run: node scripts/smoke-summary-extract.mjs
 */
import { pathToFileURL } from "url";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { spawnSync } from "child_process";
import { unlinkSync } from "fs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const tmp = join(root, "scripts", ".tmp-summary-extract.mjs");

const build = spawnSync(
  process.execPath,
  [
    join(root, "node_modules", "esbuild", "bin", "esbuild"),
    join(root, "src", "apply", "intent-apply.ts"),
    "--bundle",
    "--platform=neutral",
    "--format=esm",
    `--outfile=${tmp}`,
  ],
  { encoding: "utf8" },
);
if (build.status !== 0) {
  console.error(build.stderr || build.stdout);
  process.exit(1);
}

const mod = await import(pathToFileURL(tmp).href);
const { extractInsertableMarkdown, resolveDocumentApplyPlan, MISSING_PROPOSAL_STATUS } = mod;

const summaryBody = `**Краткое summary**

**Название:** «Эволюция коммуникаций: от наскальных рисунков до нейросетей»
**Тип:** Научно-популярная статья / эссе (5 разделов + заключение).
**Основная идея:** История человечества — это история передачи знания: демократизация знания меняла мышление и общество.
**Разделы:**
1. **1. Введение** — культурный код vs генетический; наскальная живопись.
2. **2. Механическое распространение** — книгопечатание; телеграф.
3. **3. Цифровая эра** — стирание границы автор/читатель.
4. **4. Будущее** — ИИ достраивает мысль.
5. **5. Заключение** — освобождение от пространства/времени; критическое мышление.`;

// Without proposal: markdown-fallback with full summary (no LABEL truncate).
const fallback = resolveDocumentApplyPlan("Вставь в позицию курсора", [
  { id: "a", role: "assistant", text: summaryBody, createdAt: 1 },
]);
if (!fallback || fallback.source !== "markdown-fallback" || fallback.tasks[0]?.type !== "paste_text") {
  console.error("FAIL: summary without proposal must be markdown-fallback", fallback);
  process.exit(1);
}
const fbData = fallback.tasks[0].data;
const fbText = typeof fbData === "string" ? fbData : fbData?.text;
if (!String(fbText || "").includes("Название") || !String(fbText || "").includes("Заключение")) {
  console.error("FAIL: fallback text truncated", String(fbText || "").slice(0, 200));
  process.exit(1);
}

const extracted = extractInsertableMarkdown(summaryBody);
if (!extracted.includes("Название") || !extracted.includes("Заключение")) {
  console.error("FAIL extractInsertableMarkdown truncated", extracted.slice(0, 200));
  process.exit(1);
}

const proposalJson = JSON.stringify({
  schema: "r7.proposal/v1",
  kind: "blob",
  op: "paste_text",
  text: summaryBody,
  defaultPosition: "cursor",
});
const withProposal = `${summaryBody}

\`\`\`r7.proposal
${proposalJson}
\`\`\`
`;

const plan = resolveDocumentApplyPlan("вставь", [
  { id: "a", role: "assistant", text: withProposal, applyText: withProposal, createdAt: 1 },
]);
console.log("plan source:", plan?.source, "task type:", plan?.tasks?.[0]?.type);
const data = plan?.tasks?.[0]?.data;
const text = typeof data === "string" ? data : data?.text;
if (!plan || plan.source !== "proposal" || plan.tasks[0]?.type !== "paste_text") {
  console.error("FAIL plan", plan);
  process.exit(1);
}
if (String(text) !== summaryBody) {
  console.error("FAIL: proposal text must equal full summary verbatim");
  process.exit(1);
}

const wholeWindow = "Читаю контекст.\n\nКакой-то длинный ответ без черновика и без proposal.";
const refuse = resolveDocumentApplyPlan("вставь", [
  { id: "a", role: "assistant", text: wholeWindow, createdAt: 1 },
]);
if (!refuse || refuse.source !== "missing-proposal" || refuse.tasks.length) {
  console.error("FAIL whole window must be missing-proposal", refuse);
  process.exit(1);
}
if (refuse.statusHint !== MISSING_PROPOSAL_STATUS) {
  console.error("FAIL statusHint", refuse.statusHint);
  process.exit(1);
}

// Prose summary (no **Label:**) + explicit position → fallback, not forward.
const proseSummary = `Статья «**Эволюция коммуникаций: от наскальных рисунков до нейросетей**» — популярный обзор истории развития человеческой коммуникации в 5 разделах. Охватывает путь от наскальной живописи через книгопечатание, телеграф, цифровую эру — до ИИ. Финал: главный навык XXI в. — критическая оценка информации.`;
const prosePlan = resolveDocumentApplyPlan("вставь текст в позицию курсора", [
  { id: "a", role: "assistant", text: proseSummary, createdAt: 1 },
]);
if (!prosePlan || prosePlan.source !== "markdown-fallback" || !String(prosePlan.tasks[0]?.data || "").includes("Эволюция")) {
  console.error("FAIL prose summary explicit paste", prosePlan);
  process.exit(1);
}

try {
  unlinkSync(tmp);
} catch (_) {}
console.log("OK: summary fallback + proposal primary + refuse whole window");
