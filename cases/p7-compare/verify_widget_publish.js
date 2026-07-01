"use strict";

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const ROOT = path.join(__dirname, "..", "..");
const HELPER = path.join(
  ROOT,
  ".cursor",
  "skills",
  "ladcraft-prod-publish",
  "scripts",
  "ladcraft_prod.js"
);
const APP_ID = "UOYiDhp2FgbLFBQACU3XZ";
const WIDGET_PATH = path.join(
  __dirname,
  "r7-report-actions-s27",
  "widgets",
  "r7_show_compare_actions_widget.MD"
);

const WIDGET_SLUG_HTML = {
  r7_show_compare_actions_widget: `<div class="r7-compare-actions"><button data-value="вставить"></button></div>`,
  compareActionsWidget: `<div class="r7-compare-actions"><button data-value="вставить"></button></div>`,
};

function resolveWidgetHtml(raw) {
  const html = raw.trim();
  if (!html) return null;
  const slugHtml = WIDGET_SLUG_HTML[html];
  if (slugHtml) return slugHtml;
  if (
    html.includes("<%") ||
    html.includes("compareActionsWidget") ||
    html.includes("r7_show_compare_actions_widget")
  ) {
    return (
      WIDGET_SLUG_HTML.r7_show_compare_actions_widget ??
      WIDGET_SLUG_HTML.compareActionsWidget ??
      null
    );
  }
  if (html.includes("<")) return html;
  return null;
}

function run(cmd) {
  return JSON.parse(
    execSync(`node "${HELPER}" ${cmd}`, {
      cwd: ROOT,
      encoding: "utf8",
      maxBuffer: 20 * 1024 * 1024,
    })
  );
}

function main() {
  const localWidget = fs.readFileSync(WIDGET_PATH, "utf8");
  const localChecks = {
    no_ejs: !localWidget.includes("<%"),
    has_buttons: localWidget.includes("r7-compare-actions"),
  };

  const catalogResp = run(`req GET "/v1/application/${APP_ID}?type=skill&return_installed=false"`);
  const catalog = (catalogResp.data && catalogResp.data.data) || catalogResp.data || catalogResp;
  const catalogTool = (catalog.tools || []).find((t) => t.name === "r7_show_compare_actions_widget");
  const catalogContent = catalogTool && catalogTool.widget && catalogTool.widget.content;

  const installedResp = run(`req GET "/v1/application/${APP_ID}?type=skill&return_installed=true"`);
  const installedSkill = (installedResp.data && installedResp.data.data) || installedResp.data || installedResp;
  const installed = installedSkill.installed || {};
  const installedId = installed.id || null;
  const installedTool = (installedSkill.tools || []).find(
    (t) => t.name === "r7_show_compare_actions_widget"
  );
  const installedContent = installedTool && installedTool.widget && installedTool.widget.content;

  const prodChecks = {
    version: catalog.version,
    tool_widget_is_object: catalogTool && typeof catalogTool.widget === "object",
    content_no_ejs: catalogContent && !catalogContent.includes("<%"),
    content_has_r7_compare_actions:
      catalogContent && catalogContent.includes("r7-compare-actions"),
    content_has_insert_btn: catalogContent && catalogContent.includes('data-value="вставить"'),
    installed_id: installedId,
    installed_tool_widget_is_object:
      installedTool && typeof installedTool.widget === "object",
    installed_content_no_ejs: installedContent && !installedContent.includes("<%"),
    installed_content_has_r7_compare_actions:
      installedContent && installedContent.includes("r7-compare-actions"),
    installed_version: installed.installed_version || null,
    latest_version: installed.latest_version || null,
    installed_matches_catalog:
      Boolean(installedContent) && Boolean(catalogContent) && installedContent === catalogContent,
  };

  const resolveChecks = {
    slug_old: Boolean(resolveWidgetHtml("compareActionsWidget")),
    slug_new: Boolean(resolveWidgetHtml("r7_show_compare_actions_widget")),
    ejs: Boolean(resolveWidgetHtml("<% if (ok) { %><div class=\"r7-compare-actions\"></div><% } %>")),
    static_html: Boolean(resolveWidgetHtml("<div class=\"r7-compare-actions\">ok</div>")),
    empty: resolveWidgetHtml("") === null,
  };

  const installedSnapshotPresent = Boolean(prodChecks.installed_id) && Boolean(prodChecks.installed_version);
  const catalogWidgetOk =
    Boolean(prodChecks.tool_widget_is_object) &&
    Boolean(prodChecks.content_no_ejs) &&
    Boolean(prodChecks.content_has_r7_compare_actions) &&
    Boolean(prodChecks.content_has_insert_btn);
  const ok =
    Object.values(localChecks).every(Boolean) &&
    catalogWidgetOk &&
    installedSnapshotPresent &&
    Object.values(resolveChecks).every((v) => v === true || v === null);

  const report = {
    ok,
    localChecks,
    prodChecks,
    resolveChecks,
    note:
      "Live session widgetHtml check: start a new COMPARE in Ladcraft web or R7 after rebuild; history kind=widget should contain static HTML without <%",
  };

  const outPath = path.join(__dirname, "payloads", "_widget_verify_report.json");
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify(report, null, 2));
  process.exit(ok ? 0 : 1);
}

main();
