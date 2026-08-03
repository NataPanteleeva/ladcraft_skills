/** Smoke: preferRicherOrAppend — no wipe of streamed markdown. */
import { spawnSync } from "child_process";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tmp = path.join(root, "scripts", "_smoke-text-merge-tmp.ts");
const out = path.join(root, "dist", "smoke-text-merge.js");

const source = `
import { preferRicherOrAppend } from "../src/eai/assistant-text-merge.ts";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

const rich = [
  "**Жанр:** очерк.",
  "",
  "**Черновик:**",
  "",
  "Статья про **эволюцию** коммуникаций.",
  "",
  "- устная речь",
  "- интернет",
].join("\\n");

const plain =
  "Статья «Эволюция коммуникаций» — научно-популярный очерк про историю коммуникации.";

const withFence = [
  "\`\`\`r7.proposal",
  '{"schema":"r7.proposal/v1","kind":"blob","text":"x"}',
  "\`\`\`",
].join("\\n");

assert(preferRicherOrAppend(rich, plain) === rich, "keep rich over plain replace");
assert(preferRicherOrAppend("", plain) === plain, "empty → incoming");
assert(
  preferRicherOrAppend("Hello", "Hello world").endsWith("world"),
  "growth keeps incoming",
);
assert(
  preferRicherOrAppend(rich, rich + "\\n\\nХотите проверить?").includes("Хотите"),
  "true growth appends",
);
assert(
  preferRicherOrAppend(plain, rich).includes("Черновик"),
  "prefer draft markers over plain",
);
assert(
  preferRicherOrAppend(rich, withFence).includes("r7.proposal"),
  "append missing proposal fence",
);

const draftA = [
  "**Черновик:**",
  "",
  "Эволюция коммуникаций.",
  "",
  "1. Доисторический этап",
  "",
  "Недолговечен голос.",
].join("\\n");
const draftB = [
  "**Черновик:**",
  "",
  "Эволюция коммуникаций.",
  "",
  "1. Доисторический этап",
  "",
  "Недолговечен голос.",
  "",
  "2. Механический этап",
].join("\\n");
const doubled = preferRicherOrAppend(draftA, draftA);
assert(!doubled.includes("Черновик:\\n\\n**Черновик"), "no stacked identical drafts");
assert(
  (preferRicherOrAppend(draftA, draftB).match(/Черновик/gi) || []).length === 1,
  "overlapping drafts keep one Черновик",
);

console.log("smoke-text-merge: OK");
`;

fs.writeFileSync(tmp, source);

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
