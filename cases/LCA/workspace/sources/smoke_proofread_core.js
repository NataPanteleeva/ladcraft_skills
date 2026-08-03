/**
 * Static smoke: core proofread assets present and wired.
 * Run: node cases/LCA/workspace/sources/smoke_proofread_core.js
 */
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "../..");
const checks = [];

function assert(cond, msg) {
  checks.push({ ok: Boolean(cond), msg });
  if (!cond) console.error("FAIL:", msg);
  else console.log("OK:", msg);
}

const core = fs.readFileSync(
  path.join(root, "workspace/methodology/proofread_core_rules.md"),
  "utf8",
);
assert(core.includes("Итого,:"), "core has stacked marks");
assert(core.includes("соединительным"), "core has coordinating и");
assert(core.includes("Вне core"), "core has exclusions");
assert(core.includes("чтобы"), "core has чтобы");
assert(core.includes("согласно плану"), "core has management");

const skill = fs.readFileSync(
  path.join(root, "skills/lca-proofread/SKILL.md"),
  "utf8",
);
assert(skill.includes("proofread_core_rules.md"), "skill reads core");
assert(/version:\s*2\.0\.0/.test(skill), "skill version 2.0.0");
assert(skill.includes("≤15") || skill.includes("<=15"), "skill soft-cap 15");
assert(skill.includes("high-confidence") || skill.includes("уверен"), "skill confidence gate");

const payload = JSON.parse(
  fs.readFileSync(path.join(root, "payloads/lca-proofread.api.json"), "utf8"),
);
assert(payload.version === "2.0.0", "payload version 2.0.0");
assert(
  !String(payload.detailed_description).startsWith("---"),
  "payload body without YAML frontmatter",
);
assert(
  String(payload.detailed_description).includes("proofread_core_rules.md"),
  "payload mentions core",
);

const smokeTask = fs.readFileSync(
  path.join(root, "acceptance/tasks/07-proofread-core-smoke.tasks.md"),
  "utf8",
);
assert(smokeTask.includes("Итого,:"), "acceptance smoke fixture");

const attr = fs.readFileSync(
  path.resolve(root, "../LORuGEC-main/ATTRIBUTION.md"),
  "utf8",
);
assert(attr.includes("LORuGEC"), "ATTRIBUTION present");

const failed = checks.filter((c) => !c.ok);
if (failed.length) {
  console.error("\nsmoke_proofread_core: FAILED", failed.length);
  process.exit(1);
}
console.log("\nsmoke_proofread_core: OK", checks.length);
