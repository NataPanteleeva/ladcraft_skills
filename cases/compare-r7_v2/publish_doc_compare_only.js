"use strict";

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const ROOT = path.join(__dirname, "..", "..");
const CASE = __dirname;
const HELPER = path.join(ROOT, ".cursor", "skills", "ladcraft-prod-publish", "scripts", "ladcraft_prod.js");

function prod(cmd) {
  const out = execSync(`node "${HELPER}" ${cmd}`, {
    cwd: ROOT,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  return JSON.parse(out);
}

execSync("node build_payload.js doc-compare", { cwd: CASE, stdio: "inherit" });

const raw = JSON.parse(fs.readFileSync(path.join(CASE, "payloads", "doc-compare.json"), "utf8"));
const api = {
  skill: "doc-compare-v2",
  title: "doc-compare-v2",
  name: "doc-compare-v2",
  description: raw.description,
  detailed_description: raw.skill,
  tags: raw.tags || [],
  category: raw.category || "productivity",
  icon: "document",
  version: raw.version,
  tools: [],
};

const metaPath = path.join(CASE, "skills", "doc-compare", ".from-server.json");
const meta = JSON.parse(fs.readFileSync(metaPath, "utf8"));
const tmp = path.join(CASE, "payloads", "doc-compare-v2.merged.json");
fs.writeFileSync(tmp, JSON.stringify(api, null, 2));

const result = prod(`skill-update ${meta.app_id} "${tmp.replace(/\\/g, "/")}"`);
fs.unlinkSync(tmp);

meta.version = result.version;
meta.updated_at = new Date().toISOString().slice(0, 10);
fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2) + "\n");

console.log(
  JSON.stringify(
    {
      ok: true,
      app_id: meta.app_id,
      slug: "doc-compare-v2",
      published_version: result.version,
      skill_md_version: raw.version,
    },
    null,
    2
  )
);
