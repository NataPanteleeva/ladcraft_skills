/**
 * Smoke: action-bar buttons from last AI draft; paste_cursor overrides preferReplace.
 * Run: node scripts/smoke-action-buttons.mjs
 */
import { pathToFileURL } from "url";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { spawnSync } from "child_process";
import { unlinkSync } from "fs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const tmp = join(root, "scripts", ".tmp-action-buttons.mjs");

const build = spawnSync(
  process.execPath,
  [
    join(root, "node_modules", "esbuild", "bin", "esbuild"),
    join(root, "src", "apply", "action-buttons.ts"),
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
const {
  resolveActionTarget,
  resolveActionButtons,
  planFromActionId,
  resolveInsertableText,
} = mod;

const yodaText =
  "С плагинами для документов — следующий логичный шаг это. Механическую правку отпускаем мы.";

const rewriteMsg = `**Черновик (стиль Йоды):**

${yodaText}

---

\`\`\`r7.proposal
{"schema":"r7.proposal/v1","kind":"blob","op":"replace_selection","text":${JSON.stringify(yodaText)},"preferReplaceSelection":true}
\`\`\`
`;

const messages = [
  { id: "u1", role: "user", text: "перепиши", createdAt: 1 },
  { id: "a1", role: "assistant", text: rewriteMsg, applyText: rewriteMsg, createdAt: 2 },
];

const target = resolveActionTarget(messages);
if (!target || !target.raw.includes("r7.proposal")) {
  console.error("FAIL resolveActionTarget", target);
  process.exit(1);
}

const buttons = resolveActionButtons(target, "word", "document");
const ids = buttons.map((b) => b.id);
if (!ids.includes("replace_selection") || !ids.includes("paste_cursor") || !ids.includes("download_md")) {
  console.error("FAIL word blob buttons", ids);
  process.exit(1);
}
if (buttons.find((b) => b.id === "replace_selection")?.primary !== true) {
  console.error("FAIL replace should be primary", buttons);
  process.exit(1);
}

const pastePlan = planFromActionId("paste_cursor", target);
if (!pastePlan || pastePlan.tasks[0]?.type !== "paste_text") {
  console.error("FAIL paste_cursor must be paste_text despite preferReplace", pastePlan);
  process.exit(1);
}
const pasteData = pastePlan.tasks[0].data;
const pasteText = typeof pasteData === "string" ? pasteData : pasteData?.text;
if (pasteText !== yodaText) {
  console.error("FAIL paste text", pasteText);
  process.exit(1);
}

const replacePlan = planFromActionId("replace_selection", target);
if (!replacePlan || replacePlan.tasks[0]?.type !== "replace_selection" || !replacePlan.requireSelection) {
  console.error("FAIL replace_selection", replacePlan);
  process.exit(1);
}

const replaceKeys = new Set(replacePlan.dedupeKeys);
const pasteKeys = pastePlan.dedupeKeys;
if (pasteKeys.some((k) => replaceKeys.has(k))) {
  console.error("FAIL paste and replace must not share dedupe keys", pasteKeys, replaceKeys);
  process.exit(1);
}

if (resolveInsertableText(target.raw) !== yodaText) {
  console.error("FAIL resolveInsertableText");
  process.exit(1);
}

const findingsMsg = `таблица

\`\`\`r7.proposal
{"schema":"r7.proposal/v1","kind":"findings","revision":1,"items":[{"id":1,"search":"а","replace":"б"}]}
\`\`\`
`;
const findTarget = resolveActionTarget([
  { id: "a2", role: "assistant", text: findingsMsg, applyText: findingsMsg, createdAt: 1 },
]);
const findBtns = resolveActionButtons(findTarget, "word", "document");
if (findBtns.length !== 1 || findBtns[0].id !== "fix_all") {
  console.error("FAIL findings buttons", findBtns);
  process.exit(1);
}

const cellMsg = `\`\`\`r7.proposal
{"schema":"r7.proposal/v1","kind":"cell_map","data":{"A1":"x"}}
\`\`\``;
const cellTarget = resolveActionTarget([
  { id: "a3", role: "assistant", text: cellMsg, applyText: cellMsg, createdAt: 1 },
]);
if (resolveActionButtons(cellTarget, "word", "document").some((b) => b.id === "cell_write")) {
  console.error("FAIL cell_write must not show in word");
  process.exit(1);
}
const cellBtns = resolveActionButtons(cellTarget, "cell", "spreadsheet");
if (!cellBtns.some((b) => b.id === "cell_write")) {
  console.error("FAIL cell_write in cell", cellBtns);
  process.exit(1);
}

// After local-apply ack (legacy), buttons must stay on the model draft.
const afterApply = [
  ...messages,
  {
    id: `local-apply-${Date.now()}`,
    role: "assistant",
    text: "Изменение применено в документе",
    createdAt: 3,
  },
];
const targetAfter = resolveActionTarget(afterApply);
if (!targetAfter || targetAfter.message.id !== "a1") {
  console.error("FAIL resolveActionTarget must skip local-apply", targetAfter?.message?.id);
  process.exit(1);
}
const buttonsAfter = resolveActionButtons(targetAfter, "word", "document");
if (!buttonsAfter.some((b) => b.id === "paste_cursor")) {
  console.error("FAIL buttons must persist after local-apply", buttonsAfter.map((b) => b.id));
  process.exit(1);
}
const repeatPaste = planFromActionId("paste_cursor", targetAfter);
if (!repeatPaste || repeatPaste.tasks[0]?.type !== "paste_text") {
  console.error("FAIL allowRepeat paste_text plan", repeatPaste);
  process.exit(1);
}

// Other local-* chrome (format / working) also skipped.
const withLocalFormat = [
  ...messages,
  { id: "local-format-1", role: "assistant", text: "Оформление применено", createdAt: 4 },
];
if (resolveActionTarget(withLocalFormat)?.message.id !== "a1") {
  console.error("FAIL must skip local-format");
  process.exit(1);
}

try {
  unlinkSync(tmp);
} catch (_) {}
console.log("OK: action-buttons target + override paste + dedupe + persist after apply");
