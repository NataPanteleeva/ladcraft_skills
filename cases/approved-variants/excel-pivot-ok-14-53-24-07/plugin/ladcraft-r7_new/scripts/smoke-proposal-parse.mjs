/**
 * Smoke: parseR7Proposal accepts named fence, ```json, orphan, bare JSON.
 * Run: node scripts/smoke-proposal-parse.mjs
 */
import { pathToFileURL } from "url";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { spawnSync } from "child_process";
import { unlinkSync } from "fs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const tmp = join(root, "scripts", ".tmp-proposal-parse.mjs");

const build = spawnSync(
  process.execPath,
  [
    join(root, "node_modules", "esbuild", "bin", "esbuild"),
    join(root, "src", "apply", "proposal-parse.ts"),
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

const { parseR7Proposal } = await import(pathToFileURL(tmp).href);
const blob = {
  schema: "r7.proposal/v1",
  kind: "blob",
  op: "paste_text",
  text: "полный саммари",
  defaultPosition: "cursor",
};
const json = JSON.stringify(blob);

const cases = [
  ["named", `md\n\n\`\`\`r7.proposal\n${json}\n\`\`\``],
  ["json-fence", `md\n\n\`\`\`json\n${json}\n\`\`\``],
  ["orphan", `md\n\n\`\`\`r7.proposal\n${json}`],
  ["bare", `md\n\n${json}`],
];

for (const [name, text] of cases) {
  const p = parseR7Proposal(text);
  if (!p || p.kind !== "blob" || p.text !== "полный саммари") {
    console.error("FAIL", name, p);
    process.exit(1);
  }
}

try {
  unlinkSync(tmp);
} catch (_) {}
console.log("OK: proposal parse variants");
