"use strict";

const fs = require("fs");
const path = require("path");

const bundle = JSON.parse(
  fs.readFileSync(path.join(__dirname, "bundle-summary.json"), "utf8")
);
const skillDir = path.join(__dirname, "contract_check_skill");
fs.mkdirSync(skillDir, { recursive: true });

const body = String(bundle.skill || "")
  .replace(/\\#/g, "#")
  .replace(/\\\|/g, "|")
  .trim();

const description = String(bundle.description || "").replace(/\n/g, " ").trim();

const skillMd = `---
name: contract_check_skill
description: ${description} Локальная версия для доработки (форк «27. Проверка договоров»).
version: "1.0.0"
category: analytics_reporting
icon: document
tags: []
---

${body}
`;

fs.writeFileSync(path.join(skillDir, "SKILL.md"), skillMd, "utf8");
console.log(JSON.stringify({ ok: true, skillDir, bytes: skillMd.length }, null, 2));
