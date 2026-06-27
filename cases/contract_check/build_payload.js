"use strict";

const fs = require("fs");
const path = require("path");
const YAML = require(path.join(__dirname, "..", "doc_compare", "node_modules", "yaml"));

const ROOT = __dirname;
const skillPath = path.join(ROOT, "contract_check_skill", "SKILL.md");

function parseSkillMd(filePath) {
  const skillText = fs.readFileSync(filePath, "utf8");
  const fmMatch = skillText.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  if (!fmMatch) throw new Error("invalid SKILL.md: " + filePath);
  const fm = YAML.parse(fmMatch[1]);
  return { fm, body: fmMatch[2].trim() };
}

function main() {
  const { fm, body } = parseSkillMd(skillPath);
  const payload = {
    name: fm.name,
    description: fm.description || fm.name,
    skill: body,
    version: fm.version || "1.0.0",
    tags: fm.tags || [],
    category: fm.category || "analytics_reporting",
    icon: fm.icon || "document",
    tools: [],
  };

  const outPath = path.join(ROOT, "contract_check_payload.json");
  fs.writeFileSync(outPath, JSON.stringify(payload, null, 2), "utf8");
  console.log(JSON.stringify({ ok: true, outPath, name: fm.name, bodyChars: body.length }, null, 2));
}

main();
