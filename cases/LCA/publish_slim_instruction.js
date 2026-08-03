"use strict";

/**
 * Publish slim LCA instruction + compose / proofread / analyze skills to prod.
 */
const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const ROOT = path.join(__dirname, "..", "..");
const HELPER = path.join(ROOT, ".cursor", "skills", "ladcraft-prod-publish", "scripts", "ladcraft_prod.js");
const CASE = path.join(ROOT, "cases", "LCA");
const YAML = require(path.join(ROOT, "cases", "compare-r7", "node_modules", "yaml"));

const AGENT_ID = "f5BwCaKDeDDG71zHJPvid";
const SKILLS = [
  { slug: "lca-compose", appId: "EnTQEdwfucC1BkOdDcGFx" },
  { slug: "lca-proofread", appId: "VlCmY241iOBEHNY4MpsIt" },
  { slug: "lca-analyze", appId: "4DiaVNvLdW7onc3gRui63" },
];

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
  if (!fmMatch) throw new Error("invalid SKILL.md: " + slug);
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

const summary = { agent: null, skills: [] };

prod("auth");

for (const { slug, appId } of SKILLS) {
  let payload = buildPayload(slug);
  const full = prod(`req GET "/v1/application/${appId}?type=skill"`);
  payload = mergeToolIds(payload, full.data || full);
  const out = path.join(CASE, "payloads", `${slug}.api.json`);
  fs.writeFileSync(out, JSON.stringify(payload, null, 2) + "\n");
  const updated = prod(`skill-update ${appId} "${out.replace(/\\/g, "/")}"`);
  const ver = updated.version || (updated.data && updated.data.version) || updated;
  summary.skills.push({ slug, appId, version: ver });
  console.error(`updated ${slug} →`, ver);
}

const instr = path.join(CASE, "agent", "instruction");
const patched = prod(`agent-patch ${AGENT_ID} --instruction-file "${instr.replace(/\\/g, "/")}"`);
summary.agent = { agentId: AGENT_ID, ok: true, result: patched.agent_id || patched.id || "patched" };
console.error("patched agent instruction");

const prodJsonPath = path.join(CASE, "agent", "prod.json");
const prodJson = JSON.parse(fs.readFileSync(prodJsonPath, "utf8"));
prodJson.publishedAt = new Date().toISOString();
prodJson.notes =
  "2026-07-31: slim instruction + proofread 1.6 / compose 1.1 / analyze 1.6 on prod";
fs.writeFileSync(prodJsonPath, JSON.stringify(prodJson, null, 2) + "\n");

console.log(JSON.stringify({ ok: true, ...summary }, null, 2));
