"use strict";
const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..", "..");
const HELPER = path.join(ROOT, ".cursor", "skills", "ladcraft-prod-publish", "scripts", "ladcraft_prod.js");
const AGENT_ID = "8UrXveY9LqY8gSmHl2OpM";

const out = execSync(`node "${HELPER}" agent-get ${AGENT_ID}`, { cwd: ROOT, encoding: "utf8" });
const agent = (JSON.parse(out).agent || JSON.parse(out));
const dir = path.join(__dirname, "agent");
fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(path.join(dir, "instruction"), agent.instruction);
fs.writeFileSync(
  path.join(dir, ".from-server.json"),
  JSON.stringify(
    {
      agentId: agent.agent_id,
      title: agent.title,
      syncedAt: new Date().toISOString(),
      note: "Restored from prod instruction"
    },
    null,
    2
  ) + "\n"
);
console.log(JSON.stringify({ ok: true, agent_id: agent.agent_id, instruction_bytes: agent.instruction.length }));
