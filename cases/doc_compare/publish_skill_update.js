"use strict";

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const ROOT = path.join(__dirname, "..", "..");
const HELPER = path.join(ROOT, ".cursor", "skills", "ladcraft-prod-publish", "scripts", "ladcraft_prod.js");

function prod(cmd) {
  const out = execSync(`node "${HELPER}" ${cmd}`, { encoding: "utf8", cwd: ROOT });
  return JSON.parse(out);
}

function main() {
  const skillAppId = process.argv[2] || "iYjsBqLRzhZtfGujQFPO6";
  const payloadPath = process.argv[3] || path.join(__dirname, "doc_compare_payload.json");
  execSync(`node "${path.join(__dirname, "build_payload.js")}"`, { cwd: __dirname, stdio: "inherit" });
  const payload = JSON.parse(fs.readFileSync(payloadPath, "utf8"));
  const remote = prod(`skill-get ${skillAppId}`);
  const byName = Object.fromEntries((remote.tools || []).map((t) => [t.name, t.id]));
  for (const tool of payload.tools || []) {
    if (byName[tool.name]) tool.id = byName[tool.name];
  }
  const tmp = payloadPath + ".merged.json";
  fs.writeFileSync(tmp, JSON.stringify(payload, null, 2));
  const result = prod(`skill-update ${skillAppId} ${tmp}`);
  fs.unlinkSync(tmp);
  console.log(JSON.stringify({ ok: true, skill: payload.name, ...result }, null, 2));
}

main();
