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

function mergeToolIds(payload, remoteTools) {
  const byName = Object.fromEntries((remoteTools || []).map((t) => [t.name, t.id]));
  for (const tool of payload.tools || []) {
    if (byName[tool.name]) tool.id = byName[tool.name];
  }
  return payload;
}

/** Runtime activate reads `detailed_description`, not bare `skill`. */
function toApiPayload(raw) {
  const body =
    typeof raw.skill === "string" && raw.skill.includes("\n") ? raw.skill : raw.detailed_description || "";
  return {
    ...raw,
    title: raw.title || raw.name,
    detailed_description: body,
    skill: body,
  };
}

function main() {
  const skillAppId = process.argv[2];
  const payloadPath = path.resolve(process.argv[3]);
  if (!skillAppId || !payloadPath) {
    console.error("usage: node publish_skill_update.js <skillAppId> <payload.json>");
    process.exit(1);
  }
  const payload = toApiPayload(JSON.parse(fs.readFileSync(payloadPath, "utf8")));
  const remote = prod(`skill-get ${skillAppId}`);
  mergeToolIds(payload, remote.tools);
  const tmp = path.resolve(payloadPath + ".merged.json");
  fs.writeFileSync(tmp, JSON.stringify(payload, null, 2));
  const result = prod(`skill-update ${skillAppId} "${tmp.replace(/\\/g, "/")}"`);
  fs.unlinkSync(tmp);
  console.log(JSON.stringify({ ok: true, skill: payload.name, ...result }, null, 2));
}

main();
