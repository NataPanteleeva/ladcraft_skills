"use strict";
const { execSync } = require("child_process");
const path = require("path");
const ROOT = path.join(__dirname, "..", "..");
const HELPER = path.join(ROOT, ".cursor/skills/ladcraft-prod-publish/scripts/ladcraft_prod.js");

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

for (const [label, id] of [
  ["doc-compare", "kUY4vqRPkE2PCWhZQ7z6b"],
  ["toolkit", "6EOkDFcZIgJD4ZeeG8sXF"],
]) {
  const d = get(id, false);
  const dd = d.detailed_description || "";
  console.log(label + " catalog", {
    version: d.version,
    dd_len: dd.length,
    chatMarkdown: dd.includes("chatMarkdown"),
    limit140k: dd.includes("140000"),
    oneTurn: dd.includes("Один ход"),
  });
  const di = get(id, true);
  console.log(label + " installed_meta", di.installed);
}
