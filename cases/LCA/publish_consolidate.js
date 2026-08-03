"use strict";

/**
 * Publish LCA consolidation: create lca-compose, update proofread,
 * patch instruction, bind compose, disable deprecated skills.
 */
const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const CASE = __dirname;
const ROOT = path.join(CASE, "..", "..");
const YAML = require(path.join(ROOT, "cases", "compare-r7", "node_modules", "yaml"));
const HELPER = path.join(ROOT, ".cursor", "skills", "ladcraft-prod-publish", "scripts", "ladcraft_prod.js");
const PAYLOADS = path.join(CASE, "payloads");
const AGENT_ID = "f5BwCaKDeDDG71zHJPvid";

const DEPRECATED = {
  "lca-generate": "7rq2Zq6tdxTOVppcuLAlk",
  "lca-rewrite": "L5j3OgyUKj8ZGuhS3mIPC",
  "lca-chat": "xknIBPMrgRtWG88f5jdpR",
  "lca-search-replace": "KVUxZhcRWEIVCaFrz1ULY",
};

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

function parseSkillMd(skillPath) {
  const skillText = fs.readFileSync(skillPath, "utf8");
  const fmMatch = skillText.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  if (!fmMatch) throw new Error("invalid SKILL.md: " + skillPath);
  return { fm: YAML.parse(fmMatch[1]), body: fmMatch[2].trim() };
}

function buildApiPayload(slug) {
  const skillDir = path.join(CASE, "skills", slug);
  const { fm, body } = parseSkillMd(path.join(skillDir, "SKILL.md"));
  const mcp = fm.mcp_spec || {};
  const toolNames = (mcp.tools || [])
    .map((t) => (typeof t === "string" ? t : t.name))
    .filter(Boolean);
  const scriptsDir = path.join(skillDir, "scripts");
  const tools = toolNames.map((name) => {
    const meta = readMeta(path.join(scriptsDir, name + ".meta.md"));
    const handler = fs.readFileSync(path.join(scriptsDir, name + ".js"), "utf8").trim();
    return {
      name,
      description:
        typeof meta.description === "string"
          ? meta.description.replace(/\s+/g, " ").trim()
          : name,
      runtime: "nodejs@24",
      capabilities: meta.capabilities || { required: [] },
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

function main() {
  fs.mkdirSync(PAYLOADS, { recursive: true });
  console.log("auth:", JSON.stringify(prod("auth")));

  // 1) Create or update lca-compose
  let composePayload = buildApiPayload("lca-compose");
  const composeFile = path.join(PAYLOADS, "lca-compose.api.json");
  fs.writeFileSync(composeFile, JSON.stringify(composePayload, null, 2));

  const list = prod('req GET "/v1/application/list?type%5B%5D=skill&return_installed=true"');
  const byName = new Map();
  for (const app of list.data.applications || []) {
    const key = app.name || app.title;
    if (key) byName.set(key, app);
  }

  let composeId;
  const remoteCompose = byName.get("lca-compose");
  if (remoteCompose) {
    const detail = prod(`skill-get ${remoteCompose.id}`);
    composePayload = mergeToolIds(composePayload, detail);
    // skill-get returns slim tools — need full skill for ids
    const full = prod(`req GET "/v1/application/${remoteCompose.id}?type=skill"`);
    const remoteSkill = full.data;
    composePayload = mergeToolIds(composePayload, remoteSkill);
    fs.writeFileSync(composeFile, JSON.stringify(composePayload, null, 2));
    const updated = prod(`skill-update ${remoteCompose.id} "${composeFile.replace(/\\/g, "/")}"`);
    composeId = remoteCompose.id;
    console.log("compose-updated", composeId, updated.version);
  } else {
    const created = prod(`skill-create "${composeFile.replace(/\\/g, "/")}"`);
    composeId = created.app_id;
    console.log("compose-created", composeId);
  }

  // 2) Update proofread (replace tools with search_replace only)
  let proofPayload = buildApiPayload("lca-proofread");
  const proofFile = path.join(PAYLOADS, "lca-proofread.api.json");
  const remoteProof = byName.get("lca-proofread") || { id: "VlCmY241iOBEHNY4MpsIt" };
  const proofFull = prod(`req GET "/v1/application/${remoteProof.id}?type=skill"`);
  proofPayload = mergeToolIds(proofPayload, proofFull.data);
  // Drop remote tool ids that are no longer in payload (add_comment)
  fs.writeFileSync(proofFile, JSON.stringify(proofPayload, null, 2));
  const proofUp = prod(`skill-update ${remoteProof.id} "${proofFile.replace(/\\/g, "/")}"`);
  console.log("proofread-updated", remoteProof.id, proofUp.version);

  // 3) Patch agent instruction
  const instrPath = path.join(PAYLOADS, "agent-instruction.txt");
  fs.writeFileSync(instrPath, fs.readFileSync(path.join(CASE, "agent", "instruction"), "utf8"));
  const patched = prod(
    `agent-patch ${AGENT_ID} --instruction-file "${instrPath.replace(/\\/g, "/")}"`
  );
  console.log("agent-patched", patched.ok !== false);

  // 4) Bind compose
  const bind = prod(`agent-bind ${AGENT_ID} ${composeId} --install`);
  console.log("compose-bound", bind);

  // 5) Disable deprecated bindings
  for (const [slug, appId] of Object.entries(DEPRECATED)) {
    try {
      const r = prod(`agent-bind ${AGENT_ID} ${appId} --disabled`);
      console.log("disabled", slug, r.ok !== false);
    } catch (e) {
      console.warn("disable-failed", slug, e.message);
    }
  }

  // 6) Catalog + prod.json
  const catalog = {
    "lca-analyze": "4DiaVNvLdW7onc3gRui63",
    "lca-proofread": remoteProof.id,
    "lca-compose": composeId,
    "lca-add-comment": "FBwI3FA0yL2sgMx8LV4gx",
    "lca-cell": "3fneoqEJj0Kkp0jTbQFH7",
  };
  fs.writeFileSync(
    path.join(CASE, "agent", "skill-catalog.json"),
    JSON.stringify(catalog, null, 2) + "\n"
  );

  const agentGet = prod(`agent-get ${AGENT_ID}`);
  const prodMeta = {
    agent_name: "Лингвистическая проверка текстов (LCA)",
    plugin: "cases/plugin/ladcraft-r7_new",
    tz: "5_agent_lingvisticheskaya_proverka_tekstov.docx",
    agentId: AGENT_ID,
    modelId: "4ohPFvIN0OJ48pZUR2wFk",
    skillBindings: catalog,
    deprecatedDisabled: DEPRECATED,
    publishedAt: new Date().toISOString(),
    agentGetHint: agentGet.title || agentGet.name || null,
  };
  fs.writeFileSync(path.join(CASE, "agent", "prod.json"), JSON.stringify(prodMeta, null, 2) + "\n");

  console.log(JSON.stringify({ ok: true, catalog }, null, 2));
}

main();
