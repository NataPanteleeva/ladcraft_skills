"use strict";

const fs = require("fs");
const path = require("path");
const YAML = require("yaml");

function readMeta(metaPath) {
  const text = fs.readFileSync(metaPath, "utf8");
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!m) throw new Error("no frontmatter: " + metaPath);
  const fm = YAML.parse(m[1]);
  const res = fm.resources || {};
  const network = res.network && typeof res.network === "object" ? res.network : {};
  return {
    description: fm.description || "",
    schemas: fm.schemas || { input: { type: "object" }, output: { type: "object" } },
    resources: {
      cpu: Number(res.cpu) || 0.2,
      memory: parseInt(res.memory, 10) || 128,
      timeout: parseInt(res.timeout, 10) || 30,
      network: { hosts: Array.isArray(network.hosts) ? network.hosts : [] },
    },
  };
}

function extractLibCode(skillText) {
  const m = skillText.match(/general:\s*\n\s*lib:\s*\n\s*-\s*runtime:[^\n]*\n\s*code:\s*\|\s*\n([\s\S]*?)(?=\n---|\n\S)/);
  if (!m) return "";
  const lines = m[1].split("\n");
  const indents = lines.filter((l) => l.trim()).map((l) => l.search(/\S/));
  const minIndent = Math.min(...indents);
  return lines.map((l) => (l.length >= minIndent ? l.slice(minIndent) : l)).join("\n").trim() + "\n";
}

const skillDir = path.join(__dirname, "doc_compare_toolkit");
const skillText = fs.readFileSync(path.join(skillDir, "SKILL.md"), "utf8");
const skillBody = skillText.replace(/^---[\s\S]*?---\r?\n/, "").trim();
const libCode = extractLibCode(skillText);

const defaultCaps = {
  required: [
    {
      type: "vfs",
      scope: "$USER",
      operations: ["readFile", "writeFile", "listDir", "getFileMetadata", "exists"],
    },
  ],
};

const toolNames = [
  "startup_session",
  "resolve_r7_document",
  "list_session_files",
  "list_templates",
  "compare_with_template",
  "insert_report_into_document",
  "save_report_for_download",
];

const tools = toolNames.map((name) => {
  const meta = readMeta(path.join(skillDir, "scripts", name + ".meta.md"));
  const handler = fs.readFileSync(path.join(skillDir, "scripts", name + ".js"), "utf8").trim();
  return {
    name,
    description: typeof meta.description === "string" ? meta.description.replace(/\s+/g, " ").trim() : name,
    runtime: "nodejs@24",
    capabilities: defaultCaps,
    environment: { app: {}, user: {} },
    resources: meta.resources,
    schemas: meta.schemas,
    function: handler + "\n" + libCode,
  };
});

const payload = {
  name: "doc_compare_toolkit",
  description:
    "Инструментарий сравнения документов R7: resolve_r7_document с retry, шаблоны, отчёт temp.md.",
  skill: skillBody,
  version: "1.0.2",
  tags: ["demo", "document-compare", "vfs", "r7"],
  category: "productivity",
  icon: "document",
  tools,
};

const out = path.join(__dirname, "doc_compare_payload.json");
fs.writeFileSync(out, JSON.stringify(payload, null, 2));
console.log(JSON.stringify({ ok: true, path: out, tools: tools.length }));
