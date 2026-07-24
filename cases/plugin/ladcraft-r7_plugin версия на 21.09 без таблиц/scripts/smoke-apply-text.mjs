/**
 * Smoke: display text may strip proposal; applyText keeps fence for intent-apply.
 * Run: node scripts/smoke-apply-text.mjs
 */
import { pathToFileURL } from "url";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { spawnSync } from "child_process";
import { unlinkSync } from "fs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const tmp = join(root, "scripts", ".tmp-apply-text.mjs");

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
const { resolveDocumentApplyPlan } = mod;

// sanitize is in display-sanitize — not exported from intent-apply bundle.
// Simulate sanitized display + raw applyText as chat-history does.
const sentence = "Полный текст саммари для вставки у курсора.";
const raw = `**Краткое summary**\n\n${sentence}\n\n\`\`\`r7.proposal\n${JSON.stringify({
  schema: "r7.proposal/v1",
  kind: "blob",
  op: "paste_text",
  text: sentence,
  defaultPosition: "cursor",
})}\n\`\`\``;

const displayOnly = raw.replace(/```r7\.proposal[\s\S]*?```/gi, "").trim();

const failBare = resolveDocumentApplyPlan("Вставь в позицию курсора", [
  { id: "a", role: "assistant", text: displayOnly, createdAt: 1 },
]);
if (!failBare || failBare.source !== "missing-proposal") {
  console.error("FAIL sanitized-only must miss proposal", failBare);
  process.exit(1);
}

const ok = resolveDocumentApplyPlan("Вставь в позицию курсора", [
  {
    id: "a",
    role: "assistant",
    text: displayOnly,
    applyText: raw,
    createdAt: 1,
  },
]);
if (!ok || ok.source !== "proposal" || String(ok.tasks[0]?.data) !== sentence) {
  console.error("FAIL applyText must drive proposal apply", ok);
  process.exit(1);
}
if (ok.requireSelection) {
  console.error("FAIL cursor insert must not require selection", ok);
  process.exit(1);
}

try {
  unlinkSync(tmp);
} catch (_) {}
console.log("OK: applyText preserves proposal for «Вставь в позицию курсора»");
