"use strict";
const { execSync } = require("child_process");
const path = require("path");
const helper = path.join(__dirname, "..", "..", "..", ".cursor", "skills", "ladcraft-prod-publish", "scripts", "ladcraft_prod.js");

function run(cmd) {
  return JSON.parse(execSync(`node "${helper}" ${cmd}`, { encoding: "utf8", maxBuffer: 30 * 1024 * 1024 }));
}

run("auth");
const list = run('req GET "/v1/application/list?type%5B%5D=skill&return_installed=false&limit=100&search=compare"');
const apps = ((list.data || list).applications || []).filter(Boolean);

for (const a of apps) {
  try {
    const resp = run(`req GET "/v1/application/${a.id}?type=skill&return_installed=false"`);
    const data = (resp.data || resp).data || resp.data || resp;
    for (const t of data.tools || []) {
      if (!t.widget) continue;
      const wt = typeof t.widget;
      console.log(JSON.stringify({
        skill: data.name || data.title,
        tool: t.name,
        widgetType: wt,
        widgetKeys: wt === "object" ? Object.keys(t.widget) : null,
        widgetPreview: wt === "string" ? t.widget : (t.widget.content || t.widget.template || "").slice(0, 80)
      }));
    }
  } catch (e) {
    /* skip */
  }
}
