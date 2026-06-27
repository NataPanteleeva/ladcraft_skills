"use strict";

/**
 * Отключает на агенте только навыки, ошибочно привязанные к compare-r7.
 * Не трогает остальные skills аккаунта.
 */
const { execSync } = require("child_process");
const path = require("path");

const ROOT = path.join(__dirname, "..", "..");
const HELPER = path.join(ROOT, ".cursor", "skills", "ladcraft-prod-publish", "scripts", "ladcraft_prod.js");
const AGENT_ID = "mwCvjRFNfMsFInbLjrrdr";

const ACTIVE = ["iYjsBqLRzhZtfGujQFPO6", "kFVwfGVl2rcHINNduB2yq"];
const DISABLE = ["OS2pO6ddEsm18h9ZCPJKS", "XvLg5pmJ8h5CXsmvvK97d", "TRqznAiE55l_vthY5yw_5"];

function prod(cmd) {
  return JSON.parse(execSync(`node "${HELPER}" ${cmd}`, { encoding: "utf8", cwd: ROOT }));
}

function main() {
  const results = [];
  for (const appId of DISABLE) {
    results.push({ app_id: appId, ...prod(`agent-bind ${AGENT_ID} ${appId} --disabled`) });
  }
  for (const appId of ACTIVE) {
    results.push({ app_id: appId, ...prod(`agent-bind ${AGENT_ID} ${appId} --install`) });
  }
  console.log(JSON.stringify({ ok: true, agent_id: AGENT_ID, results }, null, 2));
}

main();
