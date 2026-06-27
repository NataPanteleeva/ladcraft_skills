"use strict";

const { execSync } = require("child_process");
const path = require("path");

const ROOT = path.join(__dirname, "..", "..");
const HELPER = path.join(ROOT, ".cursor", "skills", "ladcraft-prod-publish", "scripts", "ladcraft_prod.js");
const AGENT_ID = "ZvXPOJICYTel6JQ4a0cqs";
const OLD_SKILL = "ezRJPXTos56fSBwMJ5hwr";

function prod(cmd) {
  return JSON.parse(execSync(`node "${HELPER}" ${cmd}`, { encoding: "utf8", cwd: ROOT }));
}

function main() {
  const newSkillAppId = process.argv[2];
  if (!newSkillAppId) {
    console.error("usage: node bind_agent_skills.js <newSkillAppId>");
    process.exit(1);
  }
  const results = [];
  results.push({ step: "disable_marketplace", ...prod(`agent-bind ${AGENT_ID} ${OLD_SKILL} --disabled`) });
  results.push({ step: "bind_fork", ...prod(`agent-bind ${AGENT_ID} ${newSkillAppId} --install`) });
  console.log(JSON.stringify({ ok: true, agent_id: AGENT_ID, results }, null, 2));
}

main();
