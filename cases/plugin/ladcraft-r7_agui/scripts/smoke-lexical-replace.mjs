/** Smoke: lexical «замени X на Y» → local Asc plan (not draft paste). */
import { spawnSync } from "child_process";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tmp = path.join(root, "scripts", "_smoke-lexical-tmp.ts");
const out = path.join(root, "dist", "smoke-lexical.js");

fs.writeFileSync(
  tmp,
  `
import {
  isDocumentApplyApproval,
  isLexicalSearchReplaceIntent,
  isReplaceSelectionUserIntent,
  parseLexicalSearchReplacePairs,
  planLexicalSearchReplace,
  resolveDocumentApplyPlan,
  resolveFindingsAutoApplyPlan,
} from "../src/apply/intent-apply.ts";
import { collectPendingSearchReplaceFromChat } from "../src/apply/task-runner.ts";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

const lexical = "замени слово плагин на plugin";
assert(isLexicalSearchReplaceIntent(lexical), "lexical detected");
assert(!isDocumentApplyApproval(lexical), "lexical is not draft approval");
assert(!isReplaceSelectionUserIntent(lexical), "lexical is not selection replace");

const pairs = parseLexicalSearchReplacePairs(lexical);
assert(pairs.length === 1 && pairs[0].search === "плагин" && pairs[0].replace === "plugin", "parse pair");

const localPlan = planLexicalSearchReplace(lexical);
assert(localPlan?.source === "lexical", "lexical source");
assert(localPlan?.tasks.length === 1 && localPlan.tasks[0].type === "search_replace", "search_replace task");
assert((localPlan!.tasks[0].data as { search: string }).search === "плагин", "task search");

const multi = planLexicalSearchReplace("замени A на B и C на D");
assert(multi?.tasks.length === 2, "two pairs");

const draft = {
  id: "a1",
  role: "assistant" as const,
  text: "Статья про **эволюцию**.",
  applyText: "Статья про **эволюцию**.",
};
assert(
  resolveDocumentApplyPlan(lexical, [draft]) === null,
  "lexical does not trigger draft-paste plan",
);

assert(isDocumentApplyApproval("вставь"), "вставь is approval");
assert(isDocumentApplyApproval("замени"), "bare замени is selection approval");
assert(isReplaceSelectionUserIntent("замени"), "bare замени = replace selection");

const findingsMsg = [
  "Готовлю замены по склонениям.",
  "",
  "\\\`\\\`\\\`r7.proposal",
  JSON.stringify({
    schema: "r7.proposal/v1",
    kind: "findings",
    revision: 1,
    items: [
      { id: 1, op: "search_replace", search: "плагин", replace: "plugin" },
      { id: 2, op: "search_replace", search: "плагинов", replace: "plugins" },
    ],
  }),
  "\\\`\\\`\\\`",
].join("\\n");

const auto = resolveFindingsAutoApplyPlan(
  [
    { id: "u1", role: "user", text: lexical },
    { id: "a2", role: "assistant", text: findingsMsg, applyText: findingsMsg },
  ],
  lexical,
);
assert(auto?.tasks.length === 2, "auto-apply findings after lexical");

const pending = collectPendingSearchReplaceFromChat(
  [
    { id: "u1", role: "user", text: lexical },
    { id: "a2", role: "assistant", text: findingsMsg, applyText: findingsMsg },
  ],
  new Set(),
);
assert(pending.length === 2, "chat pending search_replace for AG-UI");

const stalePending = collectPendingSearchReplaceFromChat(
  [
    { id: "u0", role: "user", text: lexical },
    { id: "a0", role: "assistant", text: findingsMsg, applyText: findingsMsg },
    { id: "u1", role: "user", text: "О чем текст?" },
    { id: "a1", role: "assistant", text: "Самари без proposal." },
  ],
  new Set(),
);
assert(stalePending.length === 0, "no stale findings apply after analyze turn");

const checkOnly = resolveFindingsAutoApplyPlan(
  [
    { id: "u1", role: "user", text: "проверь опечатки" },
    { id: "a2", role: "assistant", text: findingsMsg, applyText: findingsMsg },
  ],
  "проверь опечатки",
);
assert(checkOnly === null, "no auto-apply after mere proofread");

console.log("smoke-lexical-replace: OK");
`,
);

const build = spawnSync(
  "npx",
  ["esbuild", tmp, "--bundle", "--platform=node", `--outfile=${out}`, "--format=esm"],
  { cwd: root, encoding: "utf8", shell: true },
);
if (build.status !== 0) {
  console.error(build.stderr || build.stdout);
  process.exit(1);
}
const run = spawnSync("node", [out], { cwd: root, encoding: "utf8", shell: true });
try {
  fs.unlinkSync(tmp);
} catch {
  /* ignore */
}
if (run.status !== 0) {
  console.error(run.stderr || run.stdout);
  process.exit(1);
}
console.log((run.stdout || "").trim());
