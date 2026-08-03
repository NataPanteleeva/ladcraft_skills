/** Smoke: partial «исправь 1» must not block «Все». Run: node scripts/smoke-plan-dedupe.mjs */
import { pathToFileURL } from "url";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { spawnSync } from "child_process";
import { unlinkSync } from "fs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const tmp = join(root, "scripts", ".tmp-dedupe.mjs");
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

const { planDedupeHit } = await import(pathToFileURL(tmp).href);
const applied = new Set([
  "intent:findings:r1:1",
  "intent-plan:abc",
  'content:search_replace:{"search":"a"}',
]);
if (
  planDedupeHit(
    { dedupeKeys: ["intent:findings:r1:all", "intent-plan:x"], tasks: [] },
    applied,
  )
) {
  console.error("FAIL: «Все» blocked after «исправь 1»");
  process.exit(1);
}
if (
  !planDedupeHit(
    { dedupeKeys: ["intent:findings:r1:1", "intent-plan:y"], tasks: [] },
    applied,
  )
) {
  console.error("FAIL: same-id plan should hit");
  process.exit(1);
}
try {
  unlinkSync(tmp);
} catch (_) {}
console.log("OK: planDedupeHit ignores per-task keys");
