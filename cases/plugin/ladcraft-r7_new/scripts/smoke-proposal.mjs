/**
 * Smoke: r7.proposal findings + blob extract.
 * Run: node scripts/smoke-proposal.mjs
 */
import { pathToFileURL } from "url";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { spawnSync } from "child_process";
import { unlinkSync } from "fs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const tmp = join(root, "scripts", ".tmp-proposal.mjs");

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
const { resolveDocumentApplyPlan, extractDraftBody } = mod;

const findingsMsg = `Таблица замечаний…

| № | Было | Стало |
| 1 | а | б |
| 2 | в | г |
| 3 | д | е |

Что дальше?
— исправь все

\`\`\`r7.proposal
{
  "schema": "r7.proposal/v1",
  "kind": "findings",
  "revision": 1,
  "items": [
    { "id": 1, "op": "search_replace", "search": "а", "replace": "б" },
    { "id": 2, "op": "search_replace", "search": "в", "replace": "г" },
    { "id": 3, "op": "search_replace", "search": "д", "replace": "е" }
  ]
}
\`\`\`
`;

const planAll = resolveDocumentApplyPlan("исправь все", [
  { id: "a", role: "assistant", text: findingsMsg, createdAt: 1 },
]);
if (!planAll || planAll.tasks.length !== 3 || planAll.source !== "proposal") {
  console.error("FAIL исправь все", planAll);
  process.exit(1);
}

const planIds = resolveDocumentApplyPlan("исправь 1, 3", [
  { id: "a", role: "assistant", text: findingsMsg, createdAt: 1 },
]);
if (!planIds || planIds.itemIds?.join(",") !== "1,3" || planIds.tasks.length !== 2) {
  console.error("FAIL исправь 1,3", planIds);
  process.exit(1);
}

const planDa = resolveDocumentApplyPlan("Да", [
  { id: "a", role: "assistant", text: findingsMsg, createdAt: 1 },
]);
if (planDa) {
  console.error("FAIL short да must not apply findings", planDa);
  process.exit(1);
}

const blobMsg = `**Черновик:**
Фраза для вставки.

\`\`\`r7.proposal
{"schema":"r7.proposal/v1","kind":"blob","op":"paste_text","text":"Фраза для вставки.","defaultPosition":"cursor"}
\`\`\`
`;
const planBlob = resolveDocumentApplyPlan("вставь", [
  { id: "a", role: "assistant", text: blobMsg, createdAt: 1 },
]);
if (!planBlob || planBlob.tasks[0]?.type !== "paste_text") {
  console.error("FAIL blob paste", planBlob);
  process.exit(1);
}

const rewriteMsg = `**Исходный якорь**
старое

---

**Черновик (одной фразой):**
новое предложение.

---

Заменить абзац? («вставь» / «да»)

\`\`\`r7.proposal
{"schema":"r7.proposal/v1","kind":"blob","op":"replace_selection","text":"новое предложение.","preferReplaceSelection":true}
\`\`\`
`;
const planRw = resolveDocumentApplyPlan("да", [
  { id: "a", role: "assistant", text: rewriteMsg, createdAt: 1 },
]);
if (!planRw || planRw.tasks[0]?.type !== "replace_selection" || !planRw.requireSelection) {
  console.error("FAIL rewrite proposal", planRw);
  process.exit(1);
}
if (String(planRw.tasks[0].data) !== "новое предложение.") {
  console.error("FAIL rewrite text", planRw.tasks[0]);
  process.exit(1);
}

const wholeWindow = "Читаю контекст.\n\nКакой-то длинный ответ без черновика и без proposal.";
const refuse = resolveDocumentApplyPlan("вставь", [
  { id: "a", role: "assistant", text: wholeWindow, createdAt: 1 },
]);
if (refuse) {
  console.error("FAIL must refuse whole window", refuse);
  process.exit(1);
}

const draftOnly = extractDraftBody(rewriteMsg.replace(/```r7\.proposal[\s\S]*$/, ""));
if (draftOnly !== "новое предложение.") {
  console.error("FAIL extractDraftBody", JSON.stringify(draftOnly));
  process.exit(1);
}

try {
  unlinkSync(tmp);
} catch (_) {}
console.log("OK: proposal findings/blob/guards");
