"use strict";
const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const ROOT = path.join(__dirname, "..");
const HELPER = path.join(ROOT, "..", "..", ".cursor", "skills", "ladcraft-prod-publish", "scripts", "ladcraft_prod.js");
const APP_ID = "UOYiDhp2FgbLFBQACU3XZ";
const WIDGET_DIR = path.join(ROOT, "r7-report-actions-s27", "widgets");

function run(cmd) {
  return JSON.parse(execSync(`node "${HELPER}" ${cmd}`, { encoding: "utf8", maxBuffer: 30 * 1024 * 1024 }));
}

function readWidget(fileName) {
  const filePath = path.join(WIDGET_DIR, fileName + ".MD");
  const text = fs.readFileSync(filePath, "utf8");
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  const front = m[1];
  const body = m[2].trim();
  const nameMatch = front.match(/^name:\s*(.+)$/m);
  const descMatch = front.match(/^description:\s*(.+)$/m);
  return {
    name: nameMatch ? nameMatch[1].trim() : fileName,
    description: descMatch ? descMatch[1].trim() : fileName,
    content: body
  };
}

function getSkill() {
  const resp = run(`req GET "/v1/application/${APP_ID}?type=skill&return_installed=false"`);
  return (resp.data || resp).data || resp.data || resp;
}

function probe(label) {
  const data = getSkill();
  const tool = (data.tools || []).find((t) => t.name === "r7_show_compare_actions_widget");
  const w = tool && tool.widget;
  console.log(label, JSON.stringify({
    version: data.version,
    widgetType: typeof w,
    widgetKeys: w && typeof w === "object" ? Object.keys(w) : null,
    widgetLen: typeof w === "string" ? w.length : (w && (w.content || w.template || "")).length
  }));
}

run("auth");
const widget = readWidget("compareActionsWidget");
const skill = getSkill();
const tool = (skill.tools || []).find((t) => t.name === "r7_show_compare_actions_widget");
if (!tool) throw new Error("tool missing");

const payload = {
  skill: skill.name || "r7-report-actions-s27",
  title: skill.title || skill.name,
  name: skill.name || "r7-report-actions-s27",
  description: skill.description,
  detailed_description: skill.detailed_description || skill.skill || "",
  version: "5.0.1",
  category: skill.category || "productivity",
  icon: skill.icon || "document",
  tags: skill.tags || [],
  tools: (skill.tools || []).map((t) => {
    if (t.name !== "r7_show_compare_actions_widget") {
      return {
        id: t.id,
        name: t.name,
        description: t.description,
        runtime: t.runtime,
        schemas: t.schemas,
        capabilities: t.capabilities,
        environment: t.environment,
        resources: t.resources,
        function: t.function
      };
    }
    return {
      id: t.id,
      name: t.name,
      description: t.description,
      runtime: t.runtime,
      schemas: t.schemas,
      capabilities: t.capabilities,
      environment: t.environment,
      resources: t.resources,
      function: t.function,
      widget: {
        name: widget.name,
        description: widget.description,
        content: widget.content
      }
    };
  })
};

const tmp = path.join(ROOT, "payloads", "_widget_patch_test.json");
fs.mkdirSync(path.dirname(tmp), { recursive: true });
fs.writeFileSync(tmp, JSON.stringify(payload, null, 2));
probe("before");
run(`skill-update ${APP_ID} "${tmp.replace(/\\/g, "/")}"`);
probe("after");
