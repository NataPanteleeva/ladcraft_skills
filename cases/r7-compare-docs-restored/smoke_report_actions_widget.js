"use strict";

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const script = fs.readFileSync(
  path.join(__dirname, "r7-report-actions-s27", "scripts", "r7_prepare_report_actions.js"),
  "utf8"
);
const ctx = {};
vm.createContext(ctx);
vm.runInContext(script, ctx);

const md = `## Результаты сравнения

| Пункт | Метка |
|-------|-------|
| 1 | ⚠ Отличается |

Расхождений: 1`;

const input = ctx.normalizeInput({ markdown: md, mode: "download_html" });
if (!input.ok) {
  console.error("normalize failed", input);
  process.exit(1);
}
if (!input.htmlContent.includes("<table>")) {
  console.error("html missing table");
  process.exit(1);
}
if (!input.htmlContent.includes("<!DOCTYPE html>")) {
  console.error("html missing doctype");
  process.exit(1);
}

const widget = fs.readFileSync(
  path.join(__dirname, "r7-report-actions-s27", "widgets", "r7_show_compare_actions_widget.MD"),
  "utf8"
);
const checks = {
  no_ejs: !widget.includes("<%"),
  has_insert_btn: widget.includes('data-value="вставить"'),
  has_md_btn: widget.includes('data-value="скачать md"'),
  has_html_btn: widget.includes('data-value="скачать html"'),
  has_disk_btn: widget.includes('data-value="сохранить на диск"'),
  has_r7_compare_actions: widget.includes("r7-compare-actions")
};
const ok = Object.values(checks).every(Boolean);
console.log(JSON.stringify({ ok, checks, html_bytes: input.htmlContent.length }, null, 2));
process.exit(ok ? 0 : 1);
