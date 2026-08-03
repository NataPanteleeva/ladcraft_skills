/**
 * Smoke: Summary without proposal → replace via markdown-fallback.
 * Run: node scripts/smoke-chat-history.mjs
 */
import { pathToFileURL } from "url";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { spawnSync } from "child_process";
import { unlinkSync } from "fs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const tmp = join(root, "scripts", ".tmp-chat-history.mjs");

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
const { resolveDocumentApplyPlan, isReplaceSelectionUserIntent, extractInsertableMarkdown } = mod;

const sentence =
  "Эволюция коммуникаций освободила человека от пространственно-временных ограничений, позволяя сегодня совместно работать с коллегами по всему миру — редактируя документы на удалённых серверах в реальном времени.";

const assistantMd =
  "\n\n**Summary абзаца 1 (одним предложением):**\n\n" + sentence;

const user =
  "Замени абзац на предложенный текст\n\n---\n[Контекст R7: выделенный фрагмент в редакторе]\nЭволюция коммуникаций — это история...\n---";

if (!isReplaceSelectionUserIntent(user)) {
  console.error("FAIL isReplaceSelectionUserIntent");
  process.exit(1);
}

const body = extractInsertableMarkdown(assistantMd);
if (body !== sentence && !body.includes(sentence)) {
  // Leading **Summary …:** line may remain if not DRAFT; unwrap only whole-body emphasis.
  // Accept body that equals sentence after stripping a leading label line.
  const stripped = body.replace(/^\*\*[^*]+:\*\*\s*/m, "").trim();
  if (stripped !== sentence) {
    console.error("FAIL extract", JSON.stringify(body));
    process.exit(1);
  }
}

const plan = resolveDocumentApplyPlan(user, [
  { id: "a", role: "assistant", text: assistantMd, createdAt: 1 },
]);
if (!plan || plan.source !== "markdown-fallback") {
  console.error("FAIL plan source", plan);
  process.exit(1);
}
if (plan.tasks[0]?.type !== "replace_selection" || !plan.requireSelection) {
  console.error("FAIL plan", plan);
  process.exit(1);
}
const data = String(plan.tasks[0].data);
if (!data.includes("Эволюция коммуникаций")) {
  console.error("FAIL replace text", data);
  process.exit(1);
}

try {
  unlinkSync(tmp);
} catch (_) {}
console.log("OK: chat history Summary → replace via markdown-fallback");
