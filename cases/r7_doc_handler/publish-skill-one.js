"use strict";

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const slug = process.argv[2];
const appId = process.argv[3];
if (!slug || !appId) {
  console.error("Usage: node publish-skill-one.js <slug> <appId>");
  process.exit(1);
}

const ROOT = path.join(__dirname, "..", "..");
const CASE = __dirname;
const YAML = require(path.join(ROOT, "cases", "compare-r7", "node_modules", "yaml"));
const HELPER = path.join(ROOT, ".cursor", "skills", "ladcraft-prod-publish", "scripts", "ladcraft_prod.js");

function prod(cmd) {
  return JSON.parse(
    execSync(`node "${HELPER}" ${cmd}`, {
      cwd: ROOT,
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
    }),
  );
}

const skillPath = path.join(CASE, "skills", slug, "SKILL.md");
const skillText = fs.readFileSync(skillPath, "utf8");
const m = skillText.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
if (!m) throw new Error("invalid SKILL.md");
const fm = YAML.parse(m[1]);
const body = m[2].trim();

const api = {
  skill: slug,
  title: slug,
  name: slug,
  description: fm.description || slug,
  detailed_description: body,
  tags: fm.tags || [],
  category: fm.category || "productivity",
  icon: fm.icon || "document",
  version: fm.version || "1.0.0",
  tools: [],
};

const tmp = path.join(CASE, "payloads", slug + ".api.json");
fs.writeFileSync(tmp, JSON.stringify(api, null, 2));

const detail = prod(`skill-get ${appId}`);
const remoteSkill = detail.skill || detail;
const remoteByName = new Map((remoteSkill.tools || []).map((t) => [t.name, t]));
api.tools = (api.tools || []).map((t) => {
  const remote = remoteByName.get(t.name);
  return remote && remote.id ? { ...t, id: remote.id } : t;
});
fs.writeFileSync(tmp, JSON.stringify(api, null, 2));

const updated = prod(`skill-update ${appId} "${tmp.replace(/\\/g, "/")}"`);
console.log(
  JSON.stringify(
    {
      ok: true,
      slug,
      appId,
      version: updated.version || remoteSkill.version,
    },
    null,
    2,
  ),
);
