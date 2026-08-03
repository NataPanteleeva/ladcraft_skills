import { planFromFindingsItems, parseFixIntent, isMechanicalFindingCategory } from "../src/apply/intent-apply";
import { resolveDocumentActionButtons } from "../src/apply/action-buttons-document";
import { actionTargetKey, type ActionTarget } from "../src/apply/action-buttons-shared";

const items = [
  { id: 1, op: "search_replace" as const, search: "а", replace: "б", category: "orthography" },
  { id: 2, op: "search_replace" as const, search: "в", replace: "г", category: "punctuation" },
  { id: 3, op: "search_replace" as const, search: "д", replace: "е", category: "speech" },
];

const all = planFromFindingsItems(items, { mode: "all" });
if (!all || all.itemIds?.join(",") !== "1,2") {
  throw new Error(`expected mechanical 1,2 got ${all?.itemIds}`);
}
const speech = planFromFindingsItems(items, { mode: "category", category: "speech" });
if (!speech || speech.itemIds?.join(",") !== "3") {
  throw new Error(`expected speech 3 got ${speech?.itemIds}`);
}
if (parseFixIntent("исправь все")?.mode !== "all") throw new Error("parse все");
if (parseFixIntent("исправь правописание")?.mode !== "all") throw new Error("parse правописание");
if (parseFixIntent("исправь логику")?.mode !== "category") throw new Error("parse логику");
const styleFix = parseFixIntent("исправь стилистику");
if (styleFix?.mode !== "category" || styleFix.category !== "speech") {
  throw new Error(`parse стилистику: ${JSON.stringify(styleFix)}`);
}
const speechFix = parseFixIntent("исправь речевые");
if (speechFix?.mode !== "category" || speechFix.category !== "speech") {
  throw new Error(`parse речевые: ${JSON.stringify(speechFix)}`);
}
const idsFix = parseFixIntent("исправь 3");
if (idsFix?.mode !== "ids" || idsFix.ids?.join(",") !== "3") {
  throw new Error(`parse исправь 3: ${JSON.stringify(idsFix)}`);
}
const byId = planFromFindingsItems(items, { mode: "ids", ids: [3] });
if (!byId || byId.itemIds?.join(",") !== "3" || byId.tasks[0]?.data?.search !== "д") {
  throw new Error(`ids plan speech: ${JSON.stringify(byId?.itemIds)}`);
}
// After client agrees on style: category plan must not pull orthography/punctuation.
if (speech.tasks.some((t) => /а|в/.test(String(t.data?.search || "")))) {
  throw new Error("speech plan leaked mechanical pairs");
}
if (!isMechanicalFindingCategory("grammar") || isMechanicalFindingCategory("speech")) {
  throw new Error("mech helper");
}

const fence = JSON.stringify({
  schema: "r7.proposal/v1",
  kind: "findings",
  revision: 1,
  items,
});
const raw = "x\n```r7.proposal\n" + fence + "\n```\n";
const target = {
  message: { id: "m1", role: "assistant", text: raw },
  raw,
  fingerprint: "fp",
} as ActionTarget;
const labels = resolveDocumentActionButtons(target, {}).map((b) => b.label);
if (!labels.some((l) => /^Все: 1-2$/.test(l)) || !labels.includes("Орфо") || !labels.includes("Пункт")) {
  throw new Error(`chips missing: ${labels.join(",")}`);
}
if (labels.includes("Речь") || labels.some((l) => /логик/i.test(l))) {
  throw new Error("speech/logic chips must not appear");
}

// Scoped one category → only «Все», no duplicate Орфо chip.
const orthoOnly = [
  { id: 1, op: "search_replace" as const, search: "а", replace: "б", category: "orthography" },
  { id: 2, op: "search_replace" as const, search: "в", replace: "г", category: "orthography" },
];
const fenceOrtho = JSON.stringify({
  schema: "r7.proposal/v1",
  kind: "findings",
  revision: 1,
  items: orthoOnly,
});
const rawOrtho = "x\n```r7.proposal\n" + fenceOrtho + "\n```\n";
const targetOrtho = {
  message: { id: "m-ortho", role: "assistant", text: rawOrtho },
  raw: rawOrtho,
  fingerprint: "fp-ortho",
} as ActionTarget;
const orthoLabels = resolveDocumentActionButtons(targetOrtho, {}).map((b) => b.label);
if (orthoLabels.length !== 1 || !/^Все: 1-2$/.test(orthoLabels[0])) {
  throw new Error(`single category expected only Все: 1-2, got ${orthoLabels.join(",")}`);
}

// Sequential Орфо→Пункт→Грамм: after all category keys applied, «Все» must go gray.
const appliedKeys = new Set([
  actionTargetKey(target, "fix_orthography"),
  actionTargetKey(target, "fix_punctuation"),
  actionTargetKey(target, "fix_grammar"),
]);
const afterCats = resolveDocumentActionButtons(target, {
  appliedActionKeys: appliedKeys,
  appliedFindingIds: new Set([1, 2]), // incomplete on purpose — chips alone must settle Все
}).map((b) => ({ id: b.id, applied: b.applied, label: b.label }));
if (afterCats.length !== 1 || afterCats[0].id !== "fix_all" || !afterCats[0].applied) {
  throw new Error(`sequential cats should gray Все, got ${JSON.stringify(afterCats)}`);
}

const untagged = [
  { id: 1, op: "search_replace" as const, search: "а", replace: "б" },
  { id: 2, op: "search_replace" as const, search: "в", replace: "г" },
];
const fence2 = JSON.stringify({
  schema: "r7.proposal/v1",
  kind: "findings",
  revision: 1,
  items: untagged,
});
const raw2 = "x\n```r7.proposal\n" + fence2 + "\n```\n";
const target2 = {
  message: { id: "m2", role: "assistant", text: raw2 },
  raw: raw2,
  fingerprint: "fp2",
} as ActionTarget;
const u = resolveDocumentActionButtons(target2, {}).map((b) => b.label);
if (u.join(",") !== "Все: 1-2") throw new Error(`untagged expected Все: 1-2 got ${u}`);

console.log("smoke-findings-chips: OK");
