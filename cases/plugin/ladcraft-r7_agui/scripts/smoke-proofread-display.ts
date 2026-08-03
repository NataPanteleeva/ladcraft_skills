import { parseR7Proposal } from "../src/apply/proposal-parse";
import { isProseMarkdownTable } from "../src/markdown/html";
import { resolveDocumentActionButtons } from "../src/apply/action-buttons-document";
import type { ActionTarget } from "../src/apply/action-buttons-shared";

const md = `
### Орфографические

| № | Ошибка | Правильно |
|---|--------|-----------|
| 1 | трансформацыя | трансформация |
| 2 | пользоватся | пользоваться |

### Пунктуационные

| № | Ошибка | Правильно |
|---|--------|-----------|
| 3 | удалённо что повышает | удалённо, что повышает |
| 4 | «тяжёлый»!!! | «тяжёлый»! |

### Грамматические

| № | Ошибка | Правильно |
|---|--------|-----------|
| 5 | согласно плана | согласно плану |
`;

const proposal = parseR7Proposal(md);
if (!proposal || proposal.kind !== "findings") throw new Error("no findings");
if (proposal.items.length !== 5) throw new Error(`expected 5 got ${proposal.items.length}`);
const cats = proposal.items.map((it) => it.category).join(",");
if (cats !== "orthography,orthography,punctuation,punctuation,grammar") {
  throw new Error(`categories: ${cats}`);
}

const tableLines = [
  "| № | Ошибка | Правильно |",
  "|---|--------|-----------|",
  "| 3 | удалённо что повышает гибкость однако снижает контроль и создаёт риск для принятия решений в срок | удалённо, что повышает гибкость, однако снижает контроль |",
];
if (isProseMarkdownTable(tableLines)) {
  throw new Error("proofread table must not demote to cards");
}

const target = {
  message: { id: "m1", role: "assistant", text: md },
  raw: md,
  fingerprint: "fp",
} as ActionTarget;
const labels = resolveDocumentActionButtons(target, {}).map((b) => b.label);
if (!labels.some((l) => /^Все:/.test(l)) || !labels.includes("Орфо") || !labels.includes("Пункт") || !labels.includes("Грамм")) {
  throw new Error(`chips: ${labels.join("|")}`);
}

console.log("smoke-proofread-display: OK", labels.join(" | "));
