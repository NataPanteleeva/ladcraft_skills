"use strict";
const { execSync } = require("child_process");
const path = require("path");
const ROOT = path.join(__dirname, "..", "..");
const HELPER = path.join(ROOT, ".cursor/skills/ladcraft-prod-publish/scripts/ladcraft_prod.js");

const SKILL_ID = "TAJgJW37ybWIP5w7lmGzv";

function get(id, installed) {
  const q = installed ? "&return_installed=true" : "";
  const j = JSON.parse(
    execSync(`node "${HELPER}" req GET "/v1/application/${id}?type=skill${q}"`, {
      encoding: "utf8",
      cwd: ROOT,
    })
  );
  return j.data;
}

const d = get(SKILL_ID, true);
const dd = d.detailed_description || "";
const tools = (d.tools || []).map((t) => t.name);

const checks = {
  version: d.version,
  installed_version: d.installed && d.installed.installed_version,
  tools,
  instruction_only: tools.length === 0,
  no_load_compare_pair: tools.indexOf("load_compare_pair") < 0,
  no_prepare_compare: tools.indexOf("prepare_compare") < 0,
  dd_has_bash_head: dd.includes("head -c") && dd.includes("body.text"),
  dd_no_load_compare_call: !dd.includes("load_compare_pair({"),
};

let ok = true;
if (!checks.instruction_only) ok = false;
if (!checks.no_load_compare_pair) ok = false;
if (!checks.no_prepare_compare) ok = false;
if (!checks.dd_has_bash_head) ok = false;
if (!checks.dd_no_load_compare_call) ok = false;

console.log(JSON.stringify({ ok, ...checks }, null, 2));
if (!ok) {
  console.error(
    "Hint: if installed_version lags catalog, PATCH /v1/application/space/install/{installedId}?type=skill body {\"target_version\":\"<catalog>\"}"
  );
}
process.exit(ok ? 0 : 1);
