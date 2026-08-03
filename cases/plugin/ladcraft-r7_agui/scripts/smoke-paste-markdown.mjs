/**
 * Smoke: MD→HTML restores bold, headings, paragraphs, tables.
 * Run: node scripts/smoke-paste-markdown.mjs
 */
import { pathToFileURL } from "url";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { spawnSync } from "child_process";
import { unlinkSync, writeFileSync } from "fs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const tmp = join(root, "scripts", ".tmp-paste-markdown.mjs");
const sampleFile = join(root, "scripts", ".tmp-paste-sample.md");

const build = spawnSync(
  process.execPath,
  [
    join(root, "node_modules", "esbuild", "bin", "esbuild"),
    join(root, "src", "markdown", "html.ts"),
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

const { contentToPasteHtml } = await import(pathToFileURL(tmp).href);

const sample = `# Введение

Первый абзац текста.

Второй абзац после пустой строки.

- пункт один
- пункт два

1. нумерованный
2. второй

| № | Было | Стало |
|---|------|-------|
| 1 | а | б |
| 2 | в | г |

**Название:** тест саммари
`;

writeFileSync(sampleFile, sample, "utf8");
const html = contentToPasteHtml(sample, "text/markdown");

const checks = [
  ["h1", html.includes("<h1>") && html.includes("Введение")],
  ["paragraphs", (html.match(/<p>/g) || []).length >= 2],
  ["ul", html.includes("<ul") && html.includes("<li")],
  ["ol", html.includes("<ol") && html.includes("нумерованный")],
  ["table", html.includes("<table") && html.includes("<th") && html.includes("<td")],
  ["strong", html.includes("<strong>") && html.includes("Название")],
];

for (const [name, ok] of checks) {
  if (!ok) {
    console.error("FAIL", name, html.slice(0, 800));
    process.exit(1);
  }
}

const asHtml = contentToPasteHtml("<p><em>x</em></p>", "text/html");
if (asHtml !== "<p><em>x</em></p>") {
  console.error("FAIL html passthrough", asHtml);
  process.exit(1);
}

try {
  unlinkSync(tmp);
  unlinkSync(sampleFile);
} catch (_) {}
console.log("OK: markdown paste restores headings, paragraphs, lists, tables, bold");
