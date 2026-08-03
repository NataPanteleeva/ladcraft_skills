/** Smoke: punctuation fallback must not shorten to bare stem (файл→файл,). */
import { spawnSync } from "child_process";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tmp = path.join(root, "scripts", "_smoke-sar-fallback-tmp.ts");
const out = path.join(root, "dist", "smoke-sar-fallback.js");

fs.writeFileSync(
  tmp,
  `
import { searchReplaceFallbackPairs, isPunctuationOnlyDiff } from "../src/apply/editor-methods.ts";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

assert(isPunctuationOnlyDiff("однако", "однако,"), "punct-only token");
assert(!isPunctuationOnlyDiff("файлы", "файла"), "letter change not punct-only");

const pairs = searchReplaceFallbackPairs(
  "однако снижает синхронизацию команд",
  "однако, снижает синхронизацию команд",
);
assert(
  !pairs.some((p) => p.search === "однако" && p.replace === "однако,"),
  "must not shorten to однако→однако,",
);
assert(
  pairs.some((p) => p.search.includes("снижает")),
  "keeps phrase-level pair",
);

const filePairs = searchReplaceFallbackPairs("файл а Вы", "файл, а Вы");
assert(
  !filePairs.some((p) => p.search === "файл"),
  "must not shorten to bare файл",
);
assert(
  filePairs.some((p) => /файл а/.test(p.search)),
  "keeps файл а context",
);

const ortho = searchReplaceFallbackPairs("трансформацыя", "трансформация");
assert(ortho.some((p) => p.search === "трансформацыя"), "ortho single token kept");

console.log("smoke-sar-fallback: OK");
`,
);

const build = spawnSync(
  "npx",
  ["esbuild", tmp, "--bundle", "--outfile=" + out, "--platform=node", "--format=cjs"],
  { cwd: root, encoding: "utf8", shell: true },
);
if (build.status !== 0) {
  console.error(build.stderr || build.stdout);
  process.exit(1);
}
const run = spawnSync("node", [out], { cwd: root, encoding: "utf8" });
fs.unlinkSync(tmp);
if (run.status !== 0) {
  console.error(run.stderr || run.stdout);
  process.exit(1);
}
console.log(run.stdout.trim());
