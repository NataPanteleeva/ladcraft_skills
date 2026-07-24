"use strict";

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const SCRIPTS = path.join(__dirname, "r7-docx-render-s27", "scripts");

function loadBundle() {
  const parts = ["_markdown_report.js", "_docx_build.js"].map((f) =>
    fs.readFileSync(path.join(SCRIPTS, f), "utf8")
  );
  const ctx = { TextEncoder, TextDecoder, Buffer, btoa, atob: (s) => Buffer.from(s, "base64").toString("binary") };
  vm.createContext(ctx);
  vm.runInContext(parts.join("\n\n"), ctx);
  return ctx;
}

const SAMPLE = `## Результаты сравнения

**Шаблон:** sub_roznich.docx
**Документ:** Сублицензионный в3.docx

Краткое резюме: документ — адаптированная версия шаблона.

| Пункт | Шаблон | Документ | Комментарий | Метка |
|-------|--------|----------|-------------|-------|
| 4.1 | Ответственность за нарушение | Ответственность за нарушение | Расширены основания | 🔴 |
| 5.1 | 3 года | 5 лет | Срок конфиденциальности увеличен | 🟡 |
| 6.1 | Форс-мажор | Форс-мажор | Текст совпадает | 🟢 |
| 8.8 | 30 дней | 60 дней | Срок уведомления | ⚠ Отличается |

Резюме:
- Расширен перечень форс-мажора (п. 6.1)
- Увеличен срок конфиденциальности (п. 5.1)

Расхождений: 3
`;

function main() {
  const api = loadBundle();
  const parsed = api.parseMarkdownCompareReport(SAMPLE);
  if (!parsed.ok) {
    console.error("parse failed:", parsed.error);
    process.exit(1);
  }
  const built = api.buildDocxBytesFromMarkdown(SAMPLE);
  if (!built.ok) {
    console.error("build failed:", built.error);
    process.exit(1);
  }
  const bytes = built.bytes;
  const isZip = bytes[0] === 0x50 && bytes[1] === 0x4b;
  const xml = new TextDecoder().decode(bytes);
  const hasTable = xml.includes("<w:tbl>") || (() => {
    try {
      const zlib = require("zlib");
      // rough: search in raw zip for w:tbl string
      return Buffer.from(bytes).toString("binary").includes("w:tbl");
    } catch {
      return false;
    }
  })();

  const outPath = path.join(__dirname, "payloads", "_smoke_docx_out.docx");
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, Buffer.from(bytes));

  const buf = fs.readFileSync(outPath);
  const docXml = buf.toString("binary");
  const hasTblInFile = docXml.includes("w:tbl");
  const compMethod = buf.readUInt16LE(8);
  const zipOk = buf[0] === 0x50 && buf[1] === 0x4b && compMethod === 0;
  const styleChecks = {
    tblCellMar: docXml.includes("w:tblCellMar"),
    table_center: docXml.includes('w:jc w:val="center"'),
    title_center: docXml.includes('w:pStyle w:val="Heading1"') && docXml.includes('w:jc w:val="center"'),
    mark_red: docXml.includes('w:color w:val="C0392B"'),
    mark_yellow: docXml.includes('w:color w:val="F39C12"'),
    mark_green: docXml.includes('w:color w:val="27AE60"'),
    header_shade: docXml.includes('w:fill="E8ECF0"'),
    table_full_width: docXml.includes('w:tblW w:w="5000" w:type="pct"')
  };
  const styleOk = Object.values(styleChecks).every(Boolean);

  console.log(
    JSON.stringify(
      {
        ok: true,
        fileName: built.fileName,
        bytes: bytes.length,
        is_zip: isZip,
        zip_compression_method: compMethod,
        zip_valid_stored: zipOk,
        has_word_table: hasTblInFile,
        style_checks: styleChecks,
        style_ok: styleOk,
        sections: parsed.report.sections.length,
        table_rows: parsed.report.sections[0].tables[0].rows.length,
        outPath
      },
      null,
      2
    )
  );

  if (!isZip || !hasTblInFile || !zipOk || !styleOk) {
    process.exit(1);
  }
}

main();
