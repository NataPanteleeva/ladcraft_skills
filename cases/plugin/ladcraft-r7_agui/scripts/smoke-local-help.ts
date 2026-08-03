import { detectLocalHelpIntent } from "../src/apply/local-help";

const cases: Array<{ text: string; expect: "capabilities" | "howto" | null }> = [
  { text: "проверь стилистику текста, что можно поправить?", expect: null },
  { text: "проверь орфографию", expect: null },
  { text: "найди орфографические ошибки", expect: null },
  { text: "исправь все", expect: null },
  { text: "что умеешь?", expect: "capabilities" },
  { text: "что ты можешь делать", expect: "capabilities" },
  { text: "как работать", expect: "howto" },
  { text: "справка", expect: "howto" },
];

for (const c of cases) {
  const got = detectLocalHelpIntent(c.text, "lca");
  if (got !== c.expect) {
    throw new Error(`«${c.text}» → ${got}, expected ${c.expect}`);
  }
}
console.log("smoke-local-help: OK");
