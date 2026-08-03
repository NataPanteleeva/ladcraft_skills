/** One-shot: sample LORuGEC rows for core distillation. Not used at agent runtime. */
const XLSX = require("../../../plugin/ladcraft-r7_agui/node_modules/xlsx");
const path = require("path");
const xlsxPath = path.resolve(__dirname, "../../../LORuGEC-main/LORuGEC.xlsx");
const rows = XLSX.utils.sheet_to_json(
  XLSX.readFile(xlsxPath).Sheets.Sheet1,
  { defval: "" },
);

const want = [
  "Правописание \"не\" с глаголами",
  "Правописание \"не\" с прилагательными",
  "Правописание частицы \"не\" с существительными",
  "Правописание частицы \"не\" с причастиями",
  "Правописание \"чтобы\"",
  "Правописание \"также\"",
  "Правописание \"зато\"",
  "Правописание \"причем\" и \"притом\"",
  "Правописание \"оттого\"",
  "Пунктуация при вводных словах и конструкциях",
  "Запятая на стыке двух союзов",
  "Знаки препинания в предложениях с однородными членами: пары",
  "Обособление деепричастий после союзов",
  "Запятая перед союзом \"как\": 1",
  "Нарушение норм управления",
  "Согласование причастий с определяемым словом",
  "Плеоназмы",
  "Лексическая сочетаемость слов",
];

const by = new Map();
for (const r of rows) {
  const rule = String(r["The rule"] || "").trim();
  if (!want.includes(rule) || by.has(rule)) continue;
  if (String(r["Are both sentences the same?"] || "").toLowerCase() === "yes")
    continue;
  by.set(rule, {
    def: String(r["The definition of the rule"] || "").trim(),
    bad: String(r["Initial sentence"] || "")
      .replace(/\s+/g, " ")
      .trim(),
    good: String(r["Correct sentence"] || "")
      .replace(/\s+/g, " ")
      .trim(),
    sec: String(r["Grammar section"] || ""),
  });
}

for (const w of want) {
  const o = by.get(w);
  if (!o) {
    console.log("MISSING", w);
    continue;
  }
  console.log("===", w);
  console.log("SEC", o.sec);
  console.log("DEF", o.def.slice(0, 400));
  console.log("BAD", o.bad.slice(0, 200));
  console.log("OK ", o.good.slice(0, 200));
  console.log("");
}
