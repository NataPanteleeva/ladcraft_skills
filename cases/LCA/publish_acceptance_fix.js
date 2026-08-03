"use strict";

/**
 * Prod publish for acceptance-fix batch:
 * - skill-update: lca-compose, lca-proofread, lca-add-comment
 * - agent-patch instruction (existing LCA agent)
 * - upload changed workspace files (contexts.md, user_tasks_check.md)
 */
const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const CASE = __dirname;
const ROOT = path.join(CASE, "..", "..");
const YAML = require(path.join(ROOT, "cases", "compare-r7", "node_modules", "yaml"));
const HELPER = path.join(ROOT, ".cursor", "skills", "ladcraft-prod-publish", "scripts", "ladcraft_prod.js");
const DRIVE = path.join(ROOT, ".cursor", "skills", "ladcraft-agent-drive", "scripts", "lc_agent_drive.js");
const SKILLS_DIR = path.join(CASE, "skills");
const PAYLOADS_DIR = path.join(CASE, "payloads");
const AGENT_ID = "f5BwCaKDeDDG71zHJPvid";
const WORKSPACE_ID = "Jo8SaVDwNBsRe9bPM4Z1k";

const WORKSPACE_UPLOADS = [
  {
    local: path.join(CASE, "workspace", "methodology", "contexts.md"),
    dest: "methodology/contexts.md",
  },
  {
    local: path.join(CASE, "workspace", "methodology", "proofread_core_rules.md"),
    dest: "methodology/proofread_core_rules.md",
  },
  {
    local: path.join(CASE, "workspace", "methodology", "S02_check_and_edit.md"),
    dest: "methodology/S02_check_and_edit.md",
  },
  {
    local: path.join(CASE, "workspace", "methodology", "README.md"),
    dest: "methodology/README.md",
  },
  {
    local: path.join(CASE, "workspace", "rules", "_index.md"),
    dest: "rules/_index.md",
  },
  {
    local: path.join(CASE, "workspace", "rules", "general", "RULES.md"),
    dest: "rules/general/RULES.md",
  },
  {
    local: path.join(CASE, "workspace", "rules", "official", "RULES.md"),
    dest: "rules/official/RULES.md",
  },
  {
    local: path.join(CASE, "workspace", "rules", "scientific", "RULES.md"),
    dest: "rules/scientific/RULES.md",
  },
  {
    local: path.join(CASE, "workspace", "rules", "publicistic", "RULES.md"),
    dest: "rules/publicistic/RULES.md",
  },
  {
    local: path.join(CASE, "workspace", "rules", "literary", "RULES.md"),
    dest: "rules/literary/RULES.md",
  },
  {
    local: path.join(CASE, "workspace", "rules", "colloquial", "RULES.md"),
    dest: "rules/colloquial/RULES.md",
  },
  {
    local: path.join(CASE, "workspace", "checklists", "proofread.md"),
    dest: "checklists/proofread.md",
  },
];

/** Default: compose + instruction + workspace styles. Override: SLUGS=a,b node ... */
const SLUGS = (process.env.SLUGS || "lca-compose")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

function prod(cmd) {
  const out = execSync(`node "${HELPER}" ${cmd}`, {
    cwd: ROOT,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  return JSON.parse(out);
}

function drive(cmd) {
  const out = execSync(`node "${DRIVE}" ${cmd}`, {
    cwd: ROOT,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  try {
    return JSON.parse(out);
  } catch {
    return { ok: true, raw: out };
  }
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
    if (cap && cap.type === "vfs") {
      const scope = normalizeVfsScope(cap.scope);
      const ops = Array.isArray(cap.operations) ? cap.operations : [];
      const prev = vfsByScope.get(scope) || new Set();
      for (const op of ops) prev.add(op);
      vfsByScope.set(scope, prev);
    } else if (cap) {
      other.push(cap);
    }
  }
  const vfsCaps = [...vfsByScope.entries()].map(([scope, ops]) => ({
    type: "vfs",
    scope,
    operations: [...ops],
  }));
  return {
    ...tool,
    capabilities: { required: [...vfsCaps, ...other] },
  };
}

function buildPayload(skillDir, slug) {
  const { fm, body } = parseSkillMd(path.join(skillDir, "SKILL.md"));
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
      return normalizeToolCapabilities({
        name,
        description:
          typeof meta.description === "string"
            ? meta.description.replace(/\s+/g, " ").trim()
            : name,
        runtime: "nodejs@24",
        capabilities: meta.capabilities || defaultCaps,
        environment: { app: {}, user: {} },
        resources: meta.resources,
        schemas: meta.schemas,
        function: handler + "\n",
      });
    });
  }

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
  fs.mkdirSync(PAYLOADS_DIR, { recursive: true });
  console.log("auth:", JSON.stringify(prod("auth")));

  const catalog = JSON.parse(
    fs.readFileSync(path.join(CASE, "agent", "skill-catalog.json"), "utf8"),
  );
  const prodMeta = JSON.parse(fs.readFileSync(path.join(CASE, "agent", "prod.json"), "utf8"));
  const bindings = prodMeta.skillBindings || {};

  const updated = {};
  for (const slug of SLUGS) {
    const appId = bindings[slug] || catalog[slug];
    if (!appId) throw new Error("no app id for " + slug);
    let api = buildPayload(path.join(SKILLS_DIR, slug), slug);
    const detail = prod(`skill-get ${appId}`);
    const remote = detail.skill || detail;
    api = mergeToolIds(api, remote);
    const tmp = path.join(PAYLOADS_DIR, slug + ".api.json");
    fs.writeFileSync(tmp, JSON.stringify(api, null, 2));
    const res = prod(`skill-update ${appId} "${tmp.replace(/\\/g, "/")}"`);
    updated[slug] = { appId, version: res.version || remote.version };
    console.log("skill-updated:", slug, appId, updated[slug].version);
  }

  const instrPath = path.join(PAYLOADS_DIR, "agent-instruction.txt");
  fs.writeFileSync(instrPath, fs.readFileSync(path.join(CASE, "agent", "instruction"), "utf8"));
  const patched = prod(
    `agent-patch ${AGENT_ID} --instruction-file "${instrPath.replace(/\\/g, "/")}"`,
  );
  console.log("agent-patched:", AGENT_ID, patched.ok !== false);

  const wsUploads = [];
  for (const item of WORKSPACE_UPLOADS) {
    if (!fs.existsSync(item.local)) throw new Error("missing workspace file: " + item.local);
    const up = drive(
      `upload-workspace ${WORKSPACE_ID} "${item.local.replace(/\\/g, "/")}" ${item.dest}`,
    );
    wsUploads.push({ dest: item.dest, ok: up.ok !== false });
    console.log("workspace-upload:", item.dest, JSON.stringify(up));
  }

  prodMeta.publishedAt = new Date().toISOString();
  prodMeta.notes =
    "2026-08-03: styles official/scientific/publicistic/literary/colloquial + contexts table";
  fs.writeFileSync(path.join(CASE, "agent", "prod.json"), JSON.stringify(prodMeta, null, 2) + "\n");

  console.log(
    JSON.stringify(
      { ok: true, agentId: AGENT_ID, skills: updated, workspace: wsUploads },
      null,
      2,
    ),
  );
}

main();
