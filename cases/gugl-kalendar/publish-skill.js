"use strict";

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const CASE = __dirname;
const ROOT = path.join(CASE, "..", "..");
const YAML = require(path.join(ROOT, "cases", "compare-r7", "node_modules", "yaml"));
const HELPER = path.join(ROOT, ".cursor", "skills", "ladcraft-prod-publish", "scripts", "ladcraft_prod.js");
const SLUG = "gugl-kalendar";
const FROM_SERVER = path.join(CASE, ".from-server.json");
const PAYLOAD = path.join(CASE, ".publish-payload.json");

function knownAppId() {
  if (fs.existsSync(FROM_SERVER)) {
    try {
      const data = JSON.parse(fs.readFileSync(FROM_SERVER, "utf8"));
      if (data && data.id) return data.id;
    } catch (_) {
      /* ignore */
    }
  }
  return "2MUluuL4jLDhcC8oIj9eG";
}

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
    resources: {
      cpu: Number(res.cpu) || 0.2,
      memory: parseInt(res.memory, 10) || 128,
      timeout: parseInt(res.timeout, 10) || 60,
      network: { hosts: Array.isArray(network.hosts) ? network.hosts : [] },
    },
  };
}

function extractLibCode(skillText, fm) {
  const libs = fm.general && Array.isArray(fm.general.lib) ? fm.general.lib : [];
  const block = libs.find((b) => String(b.runtime || "").startsWith("nodejs"));
  if (!block || typeof block.code !== "string") return "";
  return block.code.trim() + "\n\n";
}

function buildPayload(skillDir) {
  const skillPath = path.join(skillDir, "SKILL.md");
  const skillText = fs.readFileSync(skillPath, "utf8");
  const fmMatch = skillText.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  if (!fmMatch) throw new Error("invalid SKILL.md");
  const fm = YAML.parse(fmMatch[1]);
  const body = fmMatch[2].trim();
  const libCode = extractLibCode(skillText, fm);
  const mcp = fm.mcp_spec || {};
  const defaultCaps = mcp.default_capabilities || { required: [] };
  const toolNames = (mcp.tools || [])
    .map((t) => (typeof t === "string" ? t : t.name))
    .filter(Boolean);

  if (fm.name !== path.basename(skillDir)) {
    throw new Error(`name mismatch: ${fm.name} vs ${path.basename(skillDir)}`);
  }
  if (!toolNames.length) throw new Error("no tools in mcp_spec.tools");

  const scriptsDir = path.join(skillDir, "scripts");
  const tools = toolNames.map((name) => {
    const meta = readMeta(path.join(scriptsDir, name + ".meta.md"));
    const handler = fs.readFileSync(path.join(scriptsDir, name + ".js"), "utf8").trim();
    return {
      name,
      description: String(meta.description || name).replace(/\s+/g, " ").trim(),
      runtime: "nodejs@24",
      capabilities: defaultCaps,
      environment: { app: {}, user: {} },
      resources: meta.resources,
      schemas: meta.schemas,
      function: libCode + handler + "\n",
    };
  });

  return {
    skill: fm.name,
    name: fm.name,
    title: fm.name,
    description: fm.description || fm.name,
    detailed_description: body,
    version: fm.version || "1.0.0",
    tags: fm.tags || ["google-calendar", "calendar", "oauth"],
    category: fm.category || "integrations",
    icon: fm.icon || "calendar",
    tools,
  };
}

function listRemoteSkills() {
  const res = prod('req GET "/v1/application/list?type%5B%5D=skill&return_installed=true"');
  const map = new Map();
  for (const app of res.data.applications || []) {
    for (const key of [app.name, app.title, app.skill]) {
      if (key) map.set(key, app);
    }
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

function resolveRemoteSkill(remoteMap) {
  const fromList = remoteMap.get(SLUG);
  if (fromList) return fromList;
  try {
    const got = prod(`skill-get ${knownAppId()}`);
    if (got && got.id) {
      return { id: got.id, tools: got.tools || [] };
    }
  } catch (_) {
    /* not found by known id */
  }
  return null;
}

function main() {
  const raw = buildPayload(CASE);
  const remoteMap = listRemoteSkills();
  const remote = resolveRemoteSkill(remoteMap);
  let api = raw;
  if (remote) {
    api = mergeToolIds(raw, remote);
    fs.writeFileSync(PAYLOAD, JSON.stringify(api, null, 2));
    const r = prod(`skill-update ${remote.id} "${PAYLOAD}"`);
    fs.writeFileSync(
      FROM_SERVER,
      JSON.stringify(
        {
          id: r.app_id,
          title: SLUG,
          version: r.version,
          tools: api.tools.map((t) => ({ name: t.name, id: t.id })),
        },
        null,
        2,
      ) + "\n",
    );
    console.log(JSON.stringify({ action: "update", app_id: r.app_id, version: r.version, tools: api.tools.length }, null, 2));
    return;
  }
  fs.writeFileSync(PAYLOAD, JSON.stringify(api, null, 2));
  const r = prod(`skill-create "${PAYLOAD}"`);
  fs.writeFileSync(
    FROM_SERVER,
    JSON.stringify({ id: r.app_id, title: SLUG, version: null, tools: [] }, null, 2) + "\n",
  );
  console.log(JSON.stringify({ action: "create", app_id: r.app_id, status: r.status, tools: api.tools.length }, null, 2));
}

main();
