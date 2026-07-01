"use strict";

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const CASE = __dirname;
const ROOT = path.join(CASE, "..", "..");
const YAML = require(path.join(ROOT, "cases", "compare-r7", "node_modules", "yaml"));
const HELPER = path.join(ROOT, ".cursor", "skills", "ladcraft-prod-publish", "scripts", "ladcraft_prod.js");
const SKILLS_DIR = path.join(CASE, "skills");
const PAYLOADS_DIR = path.join(CASE, "payloads");
const MODEL_ID = "4ohPFvIN0OJ48pZUR2wFk";

const SKILL_SLUGS = [
  "r7-analyze",
  "r7-chat",
  "r7-rewrite",
  "r7-search-replace",
  "r7-proofread",
  "r7-add-comment",
  "r7-cell",
  "r7-export",
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

function parseSkillMd(skillPath) {
  const skillText = fs.readFileSync(skillPath, "utf8");
  const fmMatch = skillText.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  if (!fmMatch) throw new Error("invalid SKILL.md: " + skillPath);
  const fm = YAML.parse(fmMatch[1]);
  return { fm, body: fmMatch[2].trim(), raw: skillText };
}

function extractLibCode(skillText) {
  const m = skillText.match(
    /general:\s*\n\s*lib:\s*\n\s*-\s*runtime:[^\n]*\n\s*code:\s*\|\s*\n([\s\S]*?)(?=\n---|\n\S)/
  );
  if (!m) return "";
  const lines = m[1].split("\n");
  const indents = lines.filter((l) => l.trim()).map((l) => l.search(/\S/));
  const minIndent = Math.min(...indents);
  return lines.map((l) => (l.length >= minIndent ? l.slice(minIndent) : l)).join("\n").trim() + "\n";
}

function normalizeVfsScope(scope) {
  if (!scope || scope === "session" || scope === "$SESSION") return "$USER";
  return scope.startsWith("$") ? scope : "$" + String(scope).toUpperCase();
}

function normalizeToolCapabilities(tool) {
  const required = tool.capabilities?.required;
  if (!Array.isArray(required)) return tool;
  const vfsByScope = new Map();
  const other = [];
  for (const cap of required) {
    if (cap.type !== "vfs") {
      other.push(cap);
      continue;
    }
    const scope = normalizeVfsScope(cap.scope);
    const prev = vfsByScope.get(scope) || { type: "vfs", scope, operations: [] };
    const ops = new Set(prev.operations);
    for (const op of cap.operations || []) ops.add(op);
    vfsByScope.set(scope, { type: "vfs", scope, operations: [...ops] });
  }
  return {
    ...tool,
    capabilities: { required: [...other, ...vfsByScope.values()] },
  };
}

function buildPayload(skillDir) {
  const skillPath = path.join(skillDir, "SKILL.md");
  const { fm, body, raw } = parseSkillMd(skillPath);
  const mcp = fm.mcp_spec || {};
  const defaultCaps = mcp.default_capabilities || { required: [] };
  const libCode = extractLibCode(raw);
  const scriptsDir = path.join(skillDir, "scripts");
  const toolNames = (mcp.tools || [])
    .map((t) => (typeof t === "string" ? t : t.name))
    .filter(Boolean);

  let tools = [];
  if (fs.existsSync(scriptsDir) && toolNames.length) {
    tools = toolNames.map((name) => {
      const meta = readMeta(path.join(scriptsDir, name + ".meta.md"));
      const handler = fs.readFileSync(path.join(scriptsDir, name + ".js"), "utf8").trim();
      const toolCaps = meta.capabilities || defaultCaps;
      return normalizeToolCapabilities({
        name,
        description:
          typeof meta.description === "string" ? meta.description.replace(/\s+/g, " ").trim() : name,
        runtime: "nodejs@24",
        capabilities: toolCaps,
        environment: { app: {}, user: {} },
        resources: meta.resources,
        schemas: meta.schemas,
        function: handler + "\n" + libCode,
      });
    });
  }

  return {
    name: fm.name,
    description: fm.description || fm.name,
    skill: body,
    version: fm.version || "1.0.0",
    tags: fm.tags || [],
    category: fm.category || "productivity",
    icon: fm.icon || "document",
    tools,
  };
}

function toApiPayload(raw, slug) {
  const body = typeof raw.skill === "string" ? raw.skill : "";
  return {
    skill: slug,
    title: slug,
    name: slug,
    description: raw.description || slug,
    detailed_description: body,
    tags: raw.tags || [],
    category: raw.category || "productivity",
    icon: raw.icon || "document",
    version: raw.version || "1.0.0",
    tools: raw.tools || [],
  };
}

function listRemoteSkills() {
  const res = prod('req GET "/v1/application/list?type%5B%5D=skill&return_installed=true"');
  const map = new Map();
  for (const app of res.data.applications || []) {
    const key = app.name || app.title;
    if (key) map.set(key, app);
  }
  return map;
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

function writeFromServer(skillDir, data) {
  fs.writeFileSync(path.join(skillDir, ".from-server.json"), JSON.stringify(data, null, 2) + "\n");
}

function main() {
  fs.mkdirSync(PAYLOADS_DIR, { recursive: true });
  const remoteMap = listRemoteSkills();
  const skills = {};

  for (const slug of SKILL_SLUGS) {
    const skillDir = path.join(SKILLS_DIR, slug);
    if (!fs.existsSync(skillDir)) throw new Error("missing skill dir: " + slug);

    const raw = buildPayload(skillDir);
    let api = toApiPayload(raw, slug);
    const tmp = path.join(PAYLOADS_DIR, slug + ".api.json");
    fs.writeFileSync(tmp, JSON.stringify(api, null, 2));

    const remote = remoteMap.get(slug);
    let appId;
    let version;
    if (remote) {
      const detail = prod(`skill-get ${remote.id}`);
      const remoteSkill = detail.skill || detail;
      api = mergeToolIds(api, remoteSkill);
      fs.writeFileSync(tmp, JSON.stringify(api, null, 2));
      const updated = prod(`skill-update ${remote.id} "${tmp.replace(/\\/g, "/")}"`);
      appId = remote.id;
      version = updated.version || remote.version;
      console.log("skill-updated:", slug, appId, version);
    } else {
      const created = prod(`skill-create "${tmp.replace(/\\/g, "/")}"`);
      appId = created.app_id;
      version = created.version || api.version;
      console.log("skill-created:", slug, appId, version);
    }

    const detail = prod(`skill-get ${appId}`);
    const skill = detail.skill || detail;
    skills[slug] = {
      app_id: appId,
      installed_application_id: skill.installed?.id || null,
      version: skill.version || version,
      tools: (skill.tools || api.tools).map((t) => t.name),
    };
    writeFromServer(skillDir, {
      app_id: appId,
      installed_application_id: skill.installed?.id || null,
      version: skills[slug].version,
      updated_at: new Date().toISOString(),
    });
  }

  const instrPath = path.join(PAYLOADS_DIR, "agent-instruction.txt");
  fs.writeFileSync(instrPath, fs.readFileSync(path.join(CASE, "agent", "instruction"), "utf8"), "utf8");

  const agentTitle = "R7 doc handler (плагин)";
  const agent = prod(
    `agent-create --title "${agentTitle}" --instruction-file "${instrPath.replace(/\\/g, "/")}" --model ${MODEL_ID}`
  );
  const agentId = agent.agent_id;
  console.log("agent-created:", agentId, agentTitle);

  for (const slug of SKILL_SLUGS) {
    const bind = prod(`agent-bind ${agentId} ${skills[slug].app_id} --install`);
    skills[slug].installed_application_id = bind.installed_application_id || skills[slug].installed_application_id;
    console.log("bound:", slug, bind.binding_id || bind.status);
  }

  const catalog = {};
  for (const slug of SKILL_SLUGS) catalog[slug] = skills[slug].app_id;
  fs.writeFileSync(path.join(CASE, "agent", "skill-catalog.json"), JSON.stringify(catalog, null, 2) + "\n");

  const fromServer = {
    agentId,
    title: agentTitle,
    primaryWorkspaceId: agent.primary_workspace_id,
    modelId: MODEL_ID,
    sourceAgentId: "t6WgR4z7hVJypzAXuyT2p",
    skills,
    syncedAt: new Date().toISOString(),
  };
  fs.writeFileSync(path.join(CASE, "agent", ".from-server.json"), JSON.stringify(fromServer, null, 2) + "\n");

  const prodMeta = JSON.parse(fs.readFileSync(path.join(CASE, "agent", "prod.json"), "utf8"));
  prodMeta.newAgent = {
    ...prodMeta.newAgent,
    agentId,
    title: agentTitle,
    primaryWorkspaceId: agent.primary_workspace_id,
    modelId: MODEL_ID,
    skillBindings: skills,
    publishedAt: new Date().toISOString(),
  };
  fs.writeFileSync(path.join(CASE, "agent", "prod.json"), JSON.stringify(prodMeta, null, 2) + "\n");

  console.log(JSON.stringify({ ok: true, agentId, skills: catalog }, null, 2));
}

main();
