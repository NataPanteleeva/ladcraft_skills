"use strict";

const { execSync } = require("child_process");
const path = require("path");
const { syncInstallAndAgent, CATALOG_ID } = require("./lib/sync-install");

const CASE = __dirname;
const ROOT = path.join(CASE, "..", "..");
const PAYLOAD = path.join(CASE, ".analytics-csv-select-skill-payload.json");

function main() {
  execSync(`python "${path.join(CASE, "build-skill-payload.py")}"`, { cwd: ROOT, stdio: "inherit" });
  const updated = require("./lib/sync-install").run(
    `skill-update ${CATALOG_ID} "${PAYLOAD}"`
  );
  console.log("skill-update:", updated.version || updated.app_id || updated);

  const synced = syncInstallAndAgent();
  console.log(JSON.stringify(synced, null, 2));
}

main();
