"use strict";

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const ROOT = path.join(__dirname, "..", "..");
const HELPER = path.join(ROOT, ".cursor", "skills", "ladcraft-prod-publish", "scripts", "ladcraft_prod.js");
const PAYLOAD = path.join(__dirname, "contract_check_payload.json");

function prod(cmd) {
  return JSON.parse(execSync(`node "${HELPER}" ${cmd}`, { encoding: "utf8", cwd: ROOT }));
}

function main() {
  const mode = process.argv[2] || "create";
  const skillAppId = process.argv[3];
  const payload = JSON.parse(fs.readFileSync(PAYLOAD, "utf8"));

  if (mode === "create") {
    const result = prod(`skill-create "${PAYLOAD.replace(/\\/g, "/")}"`);
    console.log(JSON.stringify({ ok: true, action: "create", ...result }, null, 2));
    return;
  }

  if (mode === "update") {
    if (!skillAppId) {
      console.error("usage: node publish_skill.js update <skillAppId>");
      process.exit(1);
    }
    const result = prod(`skill-update ${skillAppId} "${PAYLOAD.replace(/\\/g, "/")}"`);
    console.log(JSON.stringify({ ok: true, action: "update", ...result }, null, 2));
    return;
  }

  console.error("usage: node publish_skill.js [create|update] [skillAppId]");
  process.exit(1);
}

main();
