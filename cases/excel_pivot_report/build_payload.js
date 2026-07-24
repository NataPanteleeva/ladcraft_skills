"use strict";

const fs = require("fs");
const path = require("path");

const skillDir = path.resolve(__dirname, "excel_pivot_toolkit");
const skillMd = fs.readFileSync(path.join(skillDir, "SKILL.md"), "utf8");
const libMatch = skillMd.match(/code:\s*\|\r?\n([\s\S]*?)\r?\n---\r?\n/);
if (!libMatch) throw new Error("general.lib code not found");
const libCode = libMatch[1]
  .split(/\r?\n/)
  .map((l) => l.replace(/^ {8}/, ""))
  .join("\n")
  .trim();

const fmMatch = skillMd.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
if (!fmMatch) throw new Error("bad SKILL.md frontmatter");
const fm = fmMatch[1];
const body = fmMatch[2].trim();

const descMatch = fm.match(/description:\s*>-\n([\s\S]*?)(?=\nversion:)/);
const description = descMatch
  ? descMatch[1]
      .split(/\r?\n/)
      .map((l) => l.replace(/^ {2}/, ""))
      .join(" ")
      .replace(/\s+/g, " ")
      .trim()
  : "";

const capabilities = {
  required: [
    {
      type: "vfs",
      scope: "$USER",
      operations: [
        "readFile",
        "writeFile",
        "listDir",
        "exists",
        "isFile",
        "isDir",
        "getFileMetadata",
        "mkdir",
        "cp",
        "mv",
      ],
    },
  ],
};

function parseValue(raw) {
  const v = raw.trim();
  if (v === "") return "";
  if (v === "true") return true;
  if (v === "false") return false;
  if (v === "null" || v === "~") return null;
  if (v === "[]") return [];
  if (v === "{}") return {};
  if (/^-?\d+(\.\d+)?$/.test(v)) return Number(v);
  if (
    (v.startsWith('"') && v.endsWith('"')) ||
    (v.startsWith("'") && v.endsWith("'"))
  ) {
    return v.slice(1, -1);
  }
  return v;
}

function parseLooseYaml(src) {
  const lines = src.replace(/\t/g, "  ").split(/\r?\n/);
  let i = 0;

  function indentOf(line) {
    if (line == null) return -1;
    const m = line.match(/^( *)/);
    return m ? m[1].length : 0;
  }

  function parseBlock(minIndent) {
    const obj = {};
    let arr = null;
    let isArr = false;

    while (i < lines.length) {
      const line = lines[i];
      if (line == null) break;
      if (line.trim() === "" || line.trim().startsWith("#")) {
        i += 1;
        continue;
      }
      const ind = indentOf(line);
      if (ind < minIndent) break;
      if (ind !== minIndent) break;

      const trimmed = line.trim();
      if (trimmed.startsWith("- ")) {
        if (!isArr) {
          isArr = true;
          arr = [];
        }
        const rest = trimmed.slice(2);
        i += 1;
        if (rest.includes(":") && !rest.startsWith("{")) {
          const km = rest.match(/^([^:]+):(.*)$/);
          const item = {};
          if (km) {
            const key = km[1].trim();
            const valRaw = km[2];
            if (valRaw.trim() !== "") item[key] = parseValue(valRaw);
            else item[key] = parseBlock(minIndent + 2);
            while (i < lines.length) {
              const nline = lines[i];
              if (!nline || nline.trim() === "" || nline.trim().startsWith("#")) {
                i += 1;
                continue;
              }
              const nind = indentOf(nline);
              if (nind <= minIndent) break;
              if (nind === minIndent + 2) {
                const nt = nline.trim();
                const km2 = nt.match(/^([^:]+):(.*)$/);
                if (!km2) break;
                i += 1;
                const k2 = km2[1].trim();
                const v2 = km2[2];
                if (v2.trim() === "") item[k2] = parseBlock(minIndent + 4);
                else item[k2] = parseValue(v2);
              } else break;
            }
            arr.push(item);
          } else {
            arr.push(parseValue(rest));
          }
        } else if (rest === "") {
          arr.push(parseBlock(minIndent + 2));
        } else {
          arr.push(parseValue(rest));
        }
        continue;
      }

      const km = trimmed.match(/^([^:]+):(.*)$/);
      if (!km) {
        i += 1;
        continue;
      }
      i += 1;
      const key = km[1].trim();
      const valRaw = km[2];
      if (valRaw.trim() === "") obj[key] = parseBlock(minIndent + 2);
      else obj[key] = parseValue(valRaw);
    }

    return isArr ? arr : obj;
  }

  return parseBlock(0);
}

const toolNames = [
  "list_workbooks",
  "pick_working_source",
  "inspect_workbook",
  "build_pivot_table",
  "profile_sheet",
  "dedupe_rows",
  "filter_export",
  "select_columns",
  "sort_rows",
  "add_calculated_column",
  "time_bucket",
  "top_n_summary",
  "compare_sheets",
  "sheet_replace",
  "cell_format",
];
const tools = [];

for (const tool of toolNames) {
  const metaText = fs.readFileSync(
    path.join(skillDir, "scripts", tool + ".meta.md"),
    "utf8"
  );
  const mm = metaText.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n/);
  if (!mm) throw new Error("bad meta for " + tool);
  const y = mm[1];
  const name = (y.match(/^name:\s*(.+)$/m) || [])[1].trim();
  const runtime =
    ((y.match(/^runtime:\s*(.+)$/m) || [])[1] || "python@3").trim();
  const scriptFile =
    ((y.match(/^scriptFile:\s*(.+)$/m) || [])[1] || tool + ".py").trim();
  const descBlock = y.match(
    /description:\s*>-\r?\n([\s\S]*?)(?=\r?\n(?:runtime|scriptFile):)/
  );
  const toolDescription = descBlock
    ? descBlock[1]
        .split(/\r?\n/)
        .map((l) => l.replace(/^ {2}/, ""))
        .join(" ")
        .replace(/\s+/g, " ")
        .trim()
    : ((y.match(/^description:\s*(.+)$/m) || [])[1] || "").trim();

  const schemasPart = y.match(/schemas:\r?\n([\s\S]*?)(?=\r?\nresources:)/)[1];
  const resourcesPart = y.match(/resources:\r?\n([\s\S]*)$/)[1];
  const schemas = parseLooseYaml(
    schemasPart
      .split(/\r?\n/)
      .map((l) => l.replace(/^ {2}/, ""))
      .join("\n")
  );
  const resources = parseLooseYaml(
    resourcesPart
      .split(/\r?\n/)
      .map((l) => l.replace(/^ {2}/, ""))
      .join("\n")
  );

  const scriptText = fs
    .readFileSync(path.join(skillDir, "scripts", scriptFile), "utf8")
    .trim();

  // Python: lib first (no hoisting). JS would be handler-first.
  const functionCode =
    runtime.indexOf("python") === 0
      ? libCode + "\n\n" + scriptText + "\n"
      : scriptText + "\n\n" + libCode + "\n";

  tools.push({
    name,
    description: toolDescription,
    runtime,
    capabilities,
    environment: { app: {}, user: {} },
    resources,
    schemas,
    function: functionCode,
  });
}

const existingIdsPath = path.resolve(__dirname, "tool_ids.json");
let existingIds = {};
if (fs.existsSync(existingIdsPath)) {
  existingIds = JSON.parse(fs.readFileSync(existingIdsPath, "utf8"));
}
for (const tool of tools) {
  if (existingIds[tool.name]) tool.id = existingIds[tool.name];
}

const payload = {
  name: "excel_pivot_toolkit",
  skill: body,
  description,
  version: "1.8.0",
  tags: ["excel", "xlsx", "pivot", "analytics", "vfs"],
  category: "productivity",
  icon: "table",
  tools,
};

const out = path.resolve(__dirname, "excel_pivot_payload.json");
fs.writeFileSync(out, JSON.stringify(payload, null, 2));
console.log(
  JSON.stringify(
    {
      out,
      name: payload.name,
      runtime: payload.tools[0].runtime,
      tools: payload.tools.map((t) => ({
        name: t.name,
        id: t.id || null,
        runtime: t.runtime,
        fnLen: t.function.length,
        hosts: t.resources && t.resources.network && t.resources.network.hosts,
      })),
    },
    null,
    2
  )
);
