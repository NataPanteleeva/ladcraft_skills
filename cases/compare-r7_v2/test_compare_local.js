"use strict";

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = __dirname;
const libPath = path.join(ROOT, "skills", "r7-compare-toolkit", "scripts", "_compare_common.js");
const libCode = fs.readFileSync(libPath, "utf8");

const sandbox = {};
vm.createContext(sandbox);
vm.runInContext(libCode, sandbox);

const templateSample =
  '| ***1.1.1.2.** | ***Срок лицензии** | ***1 (один) год** |\n' +
  '| ***1.1.1.5.** | ***ОС** | ***Debian 12** |';

const docSample =
  '<table><tr><td>1.1.1.</td><td>Срок 36 месяцев</td><td>Наличие / 36 месяцев</td></tr>' +
  '<tr><td>1.1.3.</td><td>ОС Debian 11</td><td>наличие</td></tr></table>';

const textTemplate =
  '# Договор\n\n**Срок поставки:** 30 дней.\n\n**Оплата:** 100% предоплата.';

const textDoc =
  '# Договор\n\n**Срок поставки:** 45 дней.\n\n**Оплата:** 100% предоплата.';

function runCase(name, templateText, docText) {
  const result = sandbox.runDocumentCompare(templateText, docText, {});
  const report = sandbox.buildCompareReport({
    templateName: "test.md",
    sessionFile: "/session/r7/r7-test.json",
    diffs: result.diffs,
    mode: result.mode,
    warnings: result.warnings
  });
  console.log(
    JSON.stringify(
      {
        case: name,
        mode: result.mode,
        diffs: result.diffs.length,
        totalDiffs: report.meta.totalDiffs,
        critical: report.summaryTable.rows[0][1]
      },
      null,
      2
    )
  );
}

runCase("table_clauses", templateSample, docSample);
runCase("text_blocks", textTemplate, textDoc);

console.log("ok");
