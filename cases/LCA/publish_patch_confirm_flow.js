"use strict";

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const CASE = __dirname;
const ROOT = path.join(CASE, "..", "..");
const YAML = require(path.join(ROOT, "cases", "compare-r7", "node_modules", "yaml"));
const HELPER = path.join(ROOT, ".cursor", "skills", "ladcraft-prod-publish", "scripts", "ladcraft_prod.js");
const AGENT_ID = "f5BwCaKDeDDG71zHJPvid";
const SLUGS = ["lca-proofread", "lca-search-replace"];

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

function buildPayload(skillDir, slug) {
  const skillText = fs.readFileSync(path.join(skillDir, "SKILL.md"), "utf8");
  const fmMatch = skillText.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  if (!fmMatch) throw new Error("invalid SKILL.md: " + skillDir);
  const fm = YAML.parse(fmMatch[1]);
  const body = fmMatch[2].trim();
  const mcp = fm.mcp_spec || {};
  const defaultCaps = mcp.default_capabilities || { required: [] };
  const scriptsDir = path.join(skillDir, "scripts");
  const toolNames = (mcp.tools || [])
    .map((t) => (typeof t === "string" ? t : t.name))
    .filter(Boolean);

  let tools = [];
  if (fs.existsSync(scriptsDir) && toolNames.length) {
    tools = toolNames.map((name) => {
      const meta = readMeta(path.join(scriptsDir, name + ".meta.md"));
      const handler = fs.readFileSync(path.join(scriptsDir, name + ".js"), "utf8").trim();
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
  }

  return {
    skill: slug,
    title: slug,
    name: slug,
    description: fm.description || slug,
    detailed_description: body,
    tags: fm.tags || [],
    category: fm.category || "productivity",
    icon: fm.icon || "document",
    version: fm.version || "1.0.0",
    tools,
  };
}

function main() {
  const catalog = JSON.parse(fs.readFileSync(path.join(CASE, "agent", "skill-catalog.json"), "utf8"));
  fs.mkdirSync(path.join(CASE, "payloads"), { recursive: true });

  for (const slug of SLUGS) {
    const skillDir = path.join(CASE, "skills", slug);
    let api = buildPayload(skillDir, slug);
    const appId = catalog[slug];
    if (!appId) throw new Error("no catalog id for " + slug);

    const detail = prod(`skill-get ${appId}`);
    const remote = detail.skill || detail;
    const byName = new Map((remote.tools || []).map((t) => [t.name, t]));
    api.tools = (api.tools || []).map((t) => {
      const r = byName.get(t.name);
      return r && r.id ? { ...t, id: r.id } : t;
    });

    const tmp = path.join(CASE, "payloads", slug + ".api.json");
    fs.writeFileSync(tmp, JSON.stringify(api, null, 2));
    const updated = prod(`skill-update ${appId} "${tmp.replace(/\\/g, "/")}"`);
    console.log("skill-updated:", slug, appId, updated.version || "");
  }

  const instrPath = path.join(CASE, "payloads", "agent-instruction.txt");
  fs.writeFileSync(instrPath, fs.readFileSync(path.join(CASE, "agent", "instruction"), "utf8"));
  prod(`agent-patch ${AGENT_ID} --instruction-file "${instrPath.replace(/\\/g, "/")}"`);
  console.log("agent-patched:", AGENT_ID);
  console.log(JSON.stringify({ ok: true, agentId: AGENT_ID, updated: SLUGS }, null, 2));
}

main();
