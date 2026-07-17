/**
 * Smoke: analyze one-liner → replace via markdown-fallback; proposal still primary.
 * Run: node scripts/smoke-replace-analyze.mjs
 */
import { pathToFileURL } from "url";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { spawnSync } from "child_process";
import { unlinkSync } from "fs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const tmp = join(root, "scripts", ".tmp-replace-analyze.mjs");

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
const { resolveDocumentApplyPlan, isReplaceSelectionUserIntent, MISSING_PROPOSAL_STATUS } = mod;

const sentence =
  "Эволюция коммуникаций освободила человека от пространства и времени, сделав критическое мышление и способность быстро адаптироваться к новым форматам ключевым навыком XXI века.";

const analyzeMsg = `**${sentence}**`;

const userReplace = "Замени выделенный фрагмент на это предложение";
if (!isReplaceSelectionUserIntent(userReplace)) {
  console.error("FAIL isReplaceSelectionUserIntent", userReplace);
  process.exit(1);
}

// Plain analyze without proposal → markdown-fallback replace.
const planBare = resolveDocumentApplyPlan(userReplace, [
  { id: "a", role: "assistant", text: analyzeMsg, createdAt: 1 },
]);
if (!planBare || planBare.source !== "markdown-fallback") {
  console.error("FAIL bare analyze replace fallback", planBare);
  process.exit(1);
}
if (planBare.tasks[0]?.type !== "replace_selection" || !planBare.requireSelection) {
  console.error("FAIL replace_selection", planBare);
  process.exit(1);
}
if (String(planBare.tasks[0].data) !== sentence) {
  console.error("FAIL text", planBare.tasks[0].data);
  process.exit(1);
}

const proposalPaste = `Саммари.

\`\`\`r7.proposal
{"schema":"r7.proposal/v1","kind":"blob","op":"paste_text","text":${JSON.stringify(sentence)},"defaultPosition":"cursor"}
\`\`\`
`;
const planProp = resolveDocumentApplyPlan(userReplace, [
  { id: "a", role: "assistant", text: proposalPaste, applyText: proposalPaste, createdAt: 1 },
]);
if (!planProp || planProp.source !== "proposal") {
  console.error("FAIL proposal source", planProp);
  process.exit(1);
}
if (planProp.tasks[0]?.type !== "replace_selection" || String(planProp.tasks[0].data) !== sentence) {
  console.error("FAIL proposal upgrade", planProp);
  process.exit(1);
}

// Bare «вставь» refuses plain one-liner (need «вставь это» / «вставь текст» / position / да / replace).
const refuseVstav = resolveDocumentApplyPlan("вставь", [
  { id: "a", role: "assistant", text: analyzeMsg, createdAt: 1 },
]);
if (!refuseVstav || refuseVstav.source !== "missing-proposal" || refuseVstav.tasks.length) {
  console.error("FAIL bare вставь must be missing-proposal", refuseVstav);
  process.exit(1);
}
if (refuseVstav.statusHint !== MISSING_PROPOSAL_STATUS) {
  console.error("FAIL statusHint", refuseVstav.statusHint);
  process.exit(1);
}

const planVstavEto = resolveDocumentApplyPlan("вставь это", [
  { id: "a", role: "assistant", text: analyzeMsg, createdAt: 1 },
]);
if (!planVstavEto || planVstavEto.source !== "markdown-fallback" || planVstavEto.tasks[0]?.type !== "paste_text") {
  console.error("FAIL вставь это paste", planVstavEto);
  process.exit(1);
}

// «вставь текст в позицию курсора» — explicit paste of last analyze reply (no forward).
const planVstavText = resolveDocumentApplyPlan("вставь текст в позицию курсора", [
  { id: "a", role: "assistant", text: analyzeMsg, createdAt: 1 },
]);
if (
  !planVstavText ||
  planVstavText.source !== "markdown-fallback" ||
  planVstavText.tasks[0]?.type !== "paste_text"
) {
  console.error("FAIL вставь текст paste", planVstavText);
  process.exit(1);
}
if (String(planVstavText.tasks[0].data) !== sentence) {
  console.error("FAIL вставь текст body", planVstavText.tasks[0].data);
  process.exit(1);
}

const essayNote =
  "Документ написан в эссеистическом стиле, с одной сноской (пещеры Ласко, ≈17 000 лет). Упоминается «сравнительная таблица этапов», но в теле документа она не вставлена (заголовок без содержимого).";
const planEssay = resolveDocumentApplyPlan("вставь текст в позицию курсора", [
  { id: "a", role: "assistant", text: essayNote, createdAt: 1 },
]);
if (!planEssay || planEssay.source !== "markdown-fallback" || !String(planEssay.tasks[0]?.data || "").includes("эссеистическом")) {
  console.error("FAIL essay analyze explicit paste", planEssay);
  process.exit(1);
}

try {
  unlinkSync(tmp);
} catch (_) {}
console.log("OK: analyze → replace / explicit paste fallback + proposal primary");
