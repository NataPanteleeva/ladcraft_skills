"use strict";

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const ROOT = path.join(__dirname, "..", "..");
const HELPER = path.join(ROOT, ".cursor", "skills", "ladcraft-prod-publish", "scripts", "ladcraft_prod.js");
const CASE = path.join(ROOT, "cases", "LCA");
const YAML = require(path.join(ROOT, "cases", "compare-r7", "node_modules", "yaml"));
const APP_ID = "VlCmY241iOBEHNY4MpsIt";

function prod(cmd) {
  const out = execSync(`node "${HELPER}" ${cmd}`, {
    cwd: ROOT,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  return JSON.parse(out);
}

function readMeta(metaPath) {
  const text = fs.readFileSync(metaPath, "utf8");
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!m) throw new Error("no frontmatter: " + metaPath);
  const fm = YAML.parse(m[1]);
  const res = fm.resources || {};
  const network = res.network && typeof res.network === "object" ? res.network : {};
  return {
    description: fm.description || "",
    schemas: fm.schemas || { input: { type: "object" }, output: { type: "object" } },
    capabilities: fm.capabilities || null,
    resources: {
      cpu: Number(res.cpu) || 0.2,
      memory: parseInt(res.memory, 10) || 128,
      timeout: parseInt(res.timeout, 10) || 60,
      network: { hosts: Array.isArray(network.hosts) ? network.hosts : [] },
    },
  };
}

function buildPayload(slug) {
  const skillDir = path.join(CASE, "skills", slug);
  const skillText = fs.readFileSync(path.join(skillDir, "SKILL.md"), "utf8");
  const fmMatch = skillText.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  if (!fmMatch) throw new Error("invalid SKILL.md");
  const fm = YAML.parse(fmMatch[1]);
  const body = fmMatch[2].trim();
  const mcp = fm.mcp_spec || {};
  const defaultCaps = mcp.default_capabilities || { required: [] };
  const toolNames = (mcp.tools || [])
    .map((t) => (typeof t === "string" ? t : t.name))
    .filter(Boolean);
  const tools = toolNames.map((name) => {
    const meta = readMeta(path.join(skillDir, "scripts", name + ".meta.md"));
    const handler = fs.readFileSync(path.join(skillDir, "scripts", name + ".js"), "utf8").trim();
    return {
      name,
      description:
        typeof meta.description === "string" ? meta.description.replace(/\s+/g, " ").trim() : name,
      runtime: "nodejs@24",
      capabilities: meta.capabilities || defaultCaps,
      environment: { app: {}, user: {} },
      resources: meta.resources,
      schemas: meta.schemas,
      function: handler + "\n",
    };
  });
  return {
    skill: slug,
    title: slug,
    name: slug,
    description: fm.description || slug,
    detailed_description: body,
    tags: [],
    category: "productivity",
    icon: "document",
    version: fm.version || "1.0.0",
    tools,
  };
}

function mergeToolIds(apiPayload, remoteSkill) {
  const remoteByName = new Map((remoteSkill.tools || []).map((t) => [t.name, t]));
  return {
    ...apiPayload,
    tools: (apiPayload.tools || []).map((t) => {
      const remote = remoteByName.get(t.name);
      return remote && remote.id ? { ...t, id: remote.id } : t;
    }),
  };
}

prod("auth");
let payload = buildPayload("lca-proofread");
const full = prod(`req GET "/v1/application/${APP_ID}?type=skill"`);
payload = mergeToolIds(payload, full.data);
const out = path.join(CASE, "payloads", "lca-proofread.api.json");
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, JSON.stringify(payload, null, 2));
const updated = prod(`skill-update ${APP_ID} "${out.replace(/\\/g, "/")}"`);
console.log(JSON.stringify({ ok: true, app_id: APP_ID, version: updated.version || updated }, null, 2));
