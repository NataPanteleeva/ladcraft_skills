/**
 * Smoke: hide proofread skill-progress narrative; keep findings table.
 * Run: node scripts/smoke-sanitize-proofread.mjs
 */
import { pathToFileURL } from "url";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { spawnSync } from "child_process";
import { unlinkSync } from "fs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const tmpSan = join(root, "scripts", ".tmp-sanitize-proofread.mjs");
const tmpBtn = join(root, "scripts", ".tmp-doc-btns.mjs");

function bundle(entry, outfile) {
  const build = spawnSync(
    process.execPath,
    [
      join(root, "node_modules", "esbuild", "bin", "esbuild"),
      entry,
      "--bundle",
      "--platform=neutral",
      "--format=esm",
      `--outfile=${outfile}`,
    ],
    { encoding: "utf8" },
  );
  if (build.status !== 0) {
    console.error(build.stderr || build.stdout);
    process.exit(1);
  }
}

bundle(join(root, "src", "apply", "display-sanitize.ts"), tmpSan);
bundle(join(root, "src", "apply", "action-buttons-document.ts"), tmpBtn);

const { sanitizeAssistantChatText } = await import(pathToFileURL(tmpSan).href);
const { resolveDocumentActionButtons } = await import(pathToFileURL(tmpBtn).href);

const sample = `
Проверка на опечатки — навык \`lca-proofread\`. Сначала читаю документ.

Документ прочитан. Активирую \`lca-proofread\`.

Активирован. Теперь: определяю slug → читаю правила → формирую findings.

slug = \`general\`. Читаю правила.

Готово. Нашёл **6 опечаток** (все — неверные буквы в корнях/окончаниях, по п. 5 RULES):

| № | Было | Стало |
|---|---|---|
| 1 | переставл | перестал |

Что дальше?
— Напишите **исправь все**

\`\`\`r7.proposal
{"schema":"r7.proposal/v1","kind":"findings","revision":1,"items":[{"id":1,"search":"a","replace":"b"}]}
\`\`\`
`;

const out = sanitizeAssistantChatText(sample);

for (const bad of [
  "Сначала читаю документ",
  "Активирую",
  "Активирован",
  "slug =",
  "Читаю правила",
  "lca-proofread",
  "r7.proposal",
]) {
  if (out.includes(bad)) {
    console.error("FAIL still contains:", bad, "\n", out.slice(0, 500));
    process.exit(1);
  }
}

if (!out.includes("Готово. Нашёл") || !out.includes("| 1 |")) {
  console.error("FAIL lost findings body", out.slice(0, 500));
  process.exit(1);
}

const raw = sample;
const target = {
  message: { id: "a1", role: "assistant", text: out, applyText: raw },
  raw,
  fingerprint: "fp1",
};
const before = resolveDocumentActionButtons(target);
if (before[0]?.label !== "Все") {
  console.error("FAIL expected Все", before);
  process.exit(1);
}
const after = resolveDocumentActionButtons(target, {
  appliedActionKeys: new Set(["fp1:fix_all"]),
});
if (after[0]?.label !== "Применено" || after[0]?.disabled === true) {
  console.error("FAIL expected Применено clickable", after);
  process.exit(1);
}

try {
  unlinkSync(tmpSan);
  unlinkSync(tmpBtn);
} catch (_) {}
console.log("OK: sanitize proofread narrative + Применено button");
