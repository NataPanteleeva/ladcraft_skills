/** Phase-2 insert/file-ref smoke. Run: node scripts/smoke-phase2-insert.mjs */
import { spawnSync } from "child_process";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tmp = path.join(root, "scripts", "_smoke-phase2-tmp.ts");
const out = path.join(root, "dist", "smoke-phase2.js");

const draftBody = [
  "Введение.",
  "",
  "### Этапы эволюции",
  "",
  "| Этап | Суть |",
  "|---|---|",
  "| A | B |",
  "",
  "---",
  "",
  "### Главные идеи",
  "",
  "- идея 1",
  "",
  "---",
  "",
  "### Финальный тезис",
  "",
  "Тезис.",
].join("\n");

const withChernovik = [
  "**Жанр:** аналитическая выжимка.",
  "",
  "Хотите, чтобы я проверила текст на опечатки?",
  "",
  "**Черновик:**",
  "",
  draftBody,
].join("\n");

const summaryNoMarkers = [
  "**Жанр:** очерк.",
  "",
  "Статья **«Эволюция коммуникаций»** — обзорная.",
  "",
  "1. **Доинформационная эпоха** — символы.",
  "2. **Цифровая эра** — интернет.",
  "",
  "**Ключевой тезис:** критическое мышление.",
  "",
  "Хотите, чтобы я проверила текст?",
].join("\n");

const genreOnly = [
  "**Жанр:** доклад.",
  "",
  "Коротко.",
  "",
  "Хотите проверить опечатки?",
].join("\n");

const proposalJson = JSON.stringify({
  schema: "r7.proposal/v1",
  kind: "blob",
  op: "paste_text",
  text: draftBody,
  defaultPosition: "cursor",
});

fs.writeFileSync(
  tmp,
  `
import { resolveInsertableText } from "../src/apply/action-buttons-shared.ts";
import { resolveDocumentActionButtons } from "../src/apply/action-buttons-document.ts";
import { sanitizeProposalText } from "../src/apply/intent-apply.ts";
import { listLatestAssistantDeliverables } from "../src/apply/agent-deliverables.ts";
import { parseR7Proposal } from "../src/apply/proposal-parse.ts";
import { stripUserMessageSupplements } from "../src/utils/message-text.ts";

const draftBody = ${JSON.stringify(draftBody)};
const withChernovik = ${JSON.stringify(withChernovik)};
const summaryNoMarkers = ${JSON.stringify(summaryNoMarkers)};
const genreOnly = ${JSON.stringify(genreOnly)};
const withProposal =
  withChernovik +
  "\\n\\n\\\`\\\`\\\`r7.proposal\\n" +
  ${JSON.stringify(proposalJson)} +
  "\\n\\\`\\\`\\\`\\n";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

const proposal = parseR7Proposal(withProposal);
assert(proposal?.kind === "blob", "proposal parsed");
const fromProposal = resolveInsertableText(withProposal);
assert(fromProposal.includes("Главные идеи"), "proposal path keeps sections");
assert(fromProposal.includes("Финальный тезис"), "thesis kept");
assert(!/Жанр/.test(fromProposal), "genre not in proposal text path");
assert(!/Хотите/.test(fromProposal), "CTA not in proposal text");

const fromChernovik = resolveInsertableText(withChernovik);
assert(fromChernovik.includes("Главные идеи"), "chernovik keeps middle section");
assert(fromChernovik.includes("---"), "chernovik keeps HR sections");
assert(!/Жанр/.test(fromChernovik), "genre outside Черновик ignored");

const fromSummary = resolveInsertableText(summaryNoMarkers);
assert(fromSummary.includes("Эволюция"), "summary fallback keeps body");
assert(fromSummary.includes("Ключевой тезис"), "summary keeps thesis");
assert(!/Жанр/.test(fromSummary), "genre stripped in summary fallback");
assert(!/Хотите/.test(fromSummary), "CTA stripped in summary fallback");

const withTypos = summaryNoMarkers + "\\n\\nТекст содержит опечатки: *переставл* (вместо «перестал»).";
const fromNoTypos = resolveInsertableText(withTypos);
assert(fromNoTypos.includes("Эволюция"), "summary kept");
assert(!/опечатк/i.test(fromNoTypos), "typo digest stripped from insertable");

const buttonsSummary = resolveDocumentActionButtons({
  message: { id: "s", role: "assistant", text: summaryNoMarkers },
  raw: summaryNoMarkers,
  fingerprint: "s",
});
assert(buttonsSummary.some((b) => b.id === "paste_cursor"), "buttons for summary without markers");

const fromEmpty = resolveInsertableText(genreOnly);
assert(fromEmpty === "", "tiny genre-only → empty");

const buttonsEmpty = resolveDocumentActionButtons({
  message: { id: "2", role: "assistant", text: genreOnly },
  raw: genreOnly,
  fingerprint: "2",
});
assert(buttonsEmpty.length === 0, "no buttons for tiny meta-only reply");

const userWithCtx =
  "отсортируй по product_id\\n\\n---\\n[Контекст R7: workbook]\\nworkbook_path: /session/r7/x.xlsx\\n---";
assert(
  stripUserMessageSupplements(userWithCtx) === "отсортируй по product_id",
  "hide R7 workbook context from user bubble",
);

const sanitized = sanitizeProposalText(draftBody);
assert(sanitized.includes("Главные идеи") && sanitized.includes("---"), "HR sections preserved");

const withChatMarker =
  draftBody +
  "\\n\\n💬\\n\\nХотите проверить опечатки?\\nЧто дальше?";
const cutMarker = sanitizeProposalText(withChatMarker);
assert(cutMarker.includes("Главные идеи") && cutMarker.includes("---"), "body+HR kept before 💬");
assert(!/Хотите/.test(cutMarker), "CTA after 💬 stripped");
assert(!/💬/.test(cutMarker), "marker itself stripped");

const withLegacyUnderscores =
  draftBody +
  "\\n\\n__________\\n\\nСледующий раздел документа.";
const keepLegacy = sanitizeProposalText(withLegacyUnderscores);
assert(keepLegacy.includes("__________"), "legacy __________ is NOT a hard cut");
assert(keepLegacy.includes("Следующий раздел"), "text after __________ kept when not CTA");

const listed = listLatestAssistantDeliverables([
  {
    role: "assistant",
    text: "Файл: /session/out.xlsx",
    fileReferences: [
      {
        file_id: "abc123",
        path: "~/session/out.xlsx",
        display_name: "out.xlsx",
        mime_type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        file_type: "spreadsheet",
      },
    ],
  },
]);
assert(listed.length === 1 && listed[0].fileId === "abc123", "file ref deliverable");
console.log("smoke-phase2-insert: OK");
`,
);

const build = spawnSync(
  "npx",
  ["esbuild", tmp, "--bundle", "--platform=node", `--outfile=${out}`, "--format=esm"],
  { cwd: root, encoding: "utf8", shell: true },
);
if (build.status !== 0) {
  console.error(build.stderr || build.stdout);
  process.exit(1);
}
const run = spawnSync("node", [out], { cwd: root, encoding: "utf8", shell: true });
try {
  fs.unlinkSync(tmp);
} catch {
  /* ignore */
}
if (run.status !== 0) {
  console.error(run.stderr || run.stdout);
  process.exit(1);
}
console.log((run.stdout || "").trim());
