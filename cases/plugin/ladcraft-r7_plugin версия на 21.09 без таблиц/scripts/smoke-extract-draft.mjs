/**
 * Smoke: extractDraftBody must take only the Черновик section.
 * Run: node scripts/smoke-extract-draft.mjs
 */
import { pathToFileURL } from "url";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { spawnSync } from "child_process";
import { unlinkSync } from "fs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const tmp = join(root, "scripts", ".tmp-extract-draft.mjs");

// Bundle just intent-apply via esbuild to CJS-free ESM for node.
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
const { extractDraftBody, resolveDocumentApplyIntent } = mod;

const sample = `Читаю контекст и активирую навык переписывания.

**Исходный якорь**
Эволюция коммуникаций — это история освобождения человека от ограничений пространства и времени.

---

**Черновик (одной фразой):**
Цифровая эра освободила коммуникации от пространства и времени, сделав критическое мышление ключевым навыком XXI века.

---

Заменить абзац? («вставь» / «да» / «измени...»)`;

const expected =
  "Цифровая эра освободила коммуникации от пространства и времени, сделав критическое мышление ключевым навыком XXI века.";

const body = extractDraftBody(sample);
if (body !== expected) {
  console.error("FAIL extractDraftBody\n got:", JSON.stringify(body), "\nwant:", JSON.stringify(expected));
  process.exit(1);
}

const intent = resolveDocumentApplyIntent("Да", [
  { id: "1", role: "assistant", text: sample, createdAt: 1 },
  { id: "2", role: "user", text: "Да", createdAt: 2 },
]);
if (!intent || intent.kind !== "replace_selection" || intent.text !== expected) {
  console.error("FAIL intent", intent);
  process.exit(1);
}

try {
  unlinkSync(tmp);
} catch (_) {}
console.log("OK: extractDraftBody + replace_selection intent");
