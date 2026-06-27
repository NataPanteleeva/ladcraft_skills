"use strict";

const fs = require("fs");
const path = require("path");
const YAML = require("yaml");

const ROOT = __dirname;

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

function parseSkillMd(skillPath) {
  const skillText = fs.readFileSync(skillPath, "utf8");
  const fmMatch = skillText.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  if (!fmMatch) throw new Error("invalid SKILL.md: " + skillPath);
  const fm = YAML.parse(fmMatch[1]);
  return { fm, body: fmMatch[2].trim(), raw: skillText };
}

function extractLibCode(skillText) {
  const m = skillText.match(
    /general:\s*\n\s*lib:\s*\n\s*-\s*runtime:[^\n]*\n\s*code:\s*\|\s*\n([\s\S]*?)(?=\n---|\n\S)/
  );
  if (!m) return "";
  const lines = m[1].split("\n");
  const indents = lines.filter((l) => l.trim()).map((l) => l.search(/\S/));
  const minIndent = Math.min(...indents);
  return lines.map((l) => (l.length >= minIndent ? l.slice(minIndent) : l)).join("\n").trim() + "\n";
}

function buildToolSkill(skillDir) {
  const skillPath = path.join(skillDir, "SKILL.md");
  const { fm, body, raw } = parseSkillMd(skillPath);
  const libCode = extractLibCode(raw);
  const mcp = fm.mcp_spec || {};
  const defaultCaps = mcp.default_capabilities || { required: [] };
  const toolNames = (mcp.tools || []).map((t) => (typeof t === "string" ? t : t.name)).filter(Boolean);

  const scriptsDir = path.join(skillDir, "scripts");
  const commonPath = path.join(scriptsDir, "_docx_common.js");
  const commonCode = fs.existsSync(commonPath)
    ? fs.readFileSync(commonPath, "utf8").trim() + "\n"
    : "";
  const tools = toolNames.map((name) => {
    const meta = readMeta(path.join(scriptsDir, name + ".meta.md"));
    const handler = fs.readFileSync(path.join(scriptsDir, name + ".js"), "utf8").trim();
    const toolCaps = meta.capabilities || defaultCaps;
    return {
      name,
      description:
        typeof meta.description === "string" ? meta.description.replace(/\s+/g, " ").trim() : name,
      runtime: "nodejs@24",
      capabilities: toolCaps,
      environment: { app: {}, user: {} },
      resources: meta.resources,
      schemas: meta.schemas,
      function: handler + "\n" + commonCode + libCode,
    };
  });

  return {
    name: fm.name,
    description: fm.description || fm.name,
    skill: body,
    version: fm.version || "1.0.0",
    tags: fm.tags || [],
    category: fm.category || "productivity",
    icon: fm.icon || "document",
    tools,
  };
}

function buildInstructionSkill(skillDir) {
  const skillPath = path.join(skillDir, "SKILL.md");
  const { fm, body } = parseSkillMd(skillPath);
  return {
    name: fm.name,
    description: fm.description || fm.name,
    skill: body,
    version: fm.version || "1.0.0",
    tags: fm.tags || [],
    category: fm.category || "productivity",
    icon: fm.icon || "document",
    tools: [],
  };
}

function main() {
  const skillArg = process.argv[2];
  const skillDirs = skillArg
    ? [path.join(ROOT, "skills", skillArg)]
    : [
        path.join(ROOT, "skills", "r7-compare-toolkit"),
        path.join(ROOT, "skills", "r7-docx-render"),
        path.join(ROOT, "skills", "r7-export"),
        path.join(ROOT, "skills", "r7-export-compare"),
        path.join(ROOT, "skills", "doc-compare"),
      ];

  const outDir = path.join(ROOT, "payloads");
  fs.mkdirSync(outDir, { recursive: true });

  const results = [];
  for (const skillDir of skillDirs) {
    if (!fs.existsSync(skillDir)) {
      throw new Error("skill dir not found: " + skillDir);
    }
    const hasScripts = fs.existsSync(path.join(skillDir, "scripts"));
    const payload = hasScripts ? buildToolSkill(skillDir) : buildInstructionSkill(skillDir);
    const outPath = path.join(outDir, payload.name + ".json");
    fs.writeFileSync(outPath, JSON.stringify(payload, null, 2));
    results.push({ name: payload.name, path: outPath, tools: payload.tools.length });
  }

  console.log(JSON.stringify({ ok: true, payloads: results }, null, 2));
}

main();
