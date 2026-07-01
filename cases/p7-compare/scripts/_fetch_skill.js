"use strict";
const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const helper = path.join(__dirname, "..", "..", "..", ".cursor", "skills", "ladcraft-prod-publish", "scripts", "ladcraft_prod.js");
const out = execSync(`node "${helper}" req GET "/v1/application/UOYiDhp2FgbLFBQACU3XZ?type=skill&return_installed=false"`, {
  encoding: "utf8",
  maxBuffer: 30 * 1024 * 1024
});
const j = JSON.parse(out);
const d = j.data || j;
const t = (d.tools || []).find((x) => x.name === "r7_show_compare_actions_widget");
fs.writeFileSync(path.join(__dirname, "..", "payloads", "_skill_widget_probe.json"), JSON.stringify({
  version: d.version,
  widgetsRoot: d.widgets,
  toolWidget: t && t.widget,
  toolWidgetType: t && typeof t.widget
}, null, 2));
