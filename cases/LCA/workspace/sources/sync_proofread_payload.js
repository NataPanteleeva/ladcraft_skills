const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "../..");
const skillPath = path.join(root, "skills/lca-proofread/SKILL.md");
const payloadPath = path.join(root, "payloads/lca-proofread.api.json");

const raw = fs.readFileSync(skillPath, "utf8");
const fm = raw.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n/);
const body = (fm ? raw.slice(fm[0].length) : raw).replace(/^\r?\n+/, "");

let payload;
try {
  payload = JSON.parse(fs.readFileSync(payloadPath, "utf8"));
} catch {
  payload = {
    skill: "lca-proofread",
    title: "lca-proofread",
    name: "lca-proofread",
    description:
      "Лингвистическая проверка: проверь, опечатки, орфография, грамматика, пунктуация, стиль, речевые, логика; findings с category.",
    tags: [],
    category: "productivity",
    icon: "document",
    tools: [],
  };
}

payload.detailed_description = body.replace(/\r?\n/g, "\r\n");
payload.version = "2.0.0";
payload.tools = [];
fs.writeFileSync(payloadPath, JSON.stringify(payload, null, 2) + "\n");
console.log(
  "OK",
  payload.version,
  "frontmatter?",
  payload.detailed_description.startsWith("---"),
  "len",
  payload.detailed_description.length,
);
