"use strict";

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const ROOT = path.join(__dirname, "..", "..");
const CASE_DIR = __dirname;
const HELPER = path.join(
  ROOT,
  ".cursor",
  "skills",
  "ladcraft-prod-publish",
  "scripts",
  "ladcraft_prod.js"
);

const MODEL_ID = "4ohPFvIN0OJ48pZUR2wFk";
const AGENT_TITLE = "r7-compare-docs";
const SKILL_CATALOG_FILE = path.join(CASE_DIR, "skill-catalog.json");
const AGENT_META_FILE = path.join(CASE_DIR, "agent", ".from-server.json");

const HELPER_SKILL_IDS = {
  "r7-report-actions-s27": "VXJisfG60TRXVBceXr0it",
  "r7-save-compare-disk-s27": "xb_Sj95uLF1KvKPSDBA7y"
};

const DISK_SKILL_DIR = path.join(CASE_DIR, "r7-compare-disk");
const DISK_TOOLS = [
  "r7_list_disk_templates",
  "r7_fetch_disk_template",
  "r7_fetch_disk_document"
];

function run(cmd) {
  const full = `node "${HELPER}" ${cmd}`;
  const out = execSync(full, {
    cwd: ROOT,
    encoding: "utf8",
    stdio: ["pipe", "pipe", "pipe"],
    maxBuffer: 20 * 1024 * 1024
  });
  return JSON.parse(out);
}

function readSkillCatalogIds() {
  if (fs.existsSync(SKILL_CATALOG_FILE)) {
    try {
      return { ...HELPER_SKILL_IDS, ...JSON.parse(fs.readFileSync(SKILL_CATALOG_FILE, "utf8")) };
    } catch {
      /* ignore */
    }
  }
  return { ...HELPER_SKILL_IDS };
}

function writeSkillCatalogIds(map) {
  fs.mkdirSync(path.dirname(SKILL_CATALOG_FILE), { recursive: true });
  fs.writeFileSync(SKILL_CATALOG_FILE, JSON.stringify(map, null, 2) + "\n");
}

function readAgentMeta() {
  if (!fs.existsSync(AGENT_META_FILE)) return null;
  try {
    return JSON.parse(fs.readFileSync(AGENT_META_FILE, "utf8"));
  } catch {
    return null;
  }
}

function writeAgentMeta(meta) {
  fs.mkdirSync(path.dirname(AGENT_META_FILE), { recursive: true });
  fs.writeFileSync(AGENT_META_FILE, JSON.stringify(meta, null, 2) + "\n");
}

function readSkillBody(skillDir) {
  const text = fs.readFileSync(path.join(skillDir, "SKILL.md"), "utf8");
  const m = text.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n([\s\S]*)$/);
  if (!m) throw new Error("Invalid SKILL.md frontmatter: " + skillDir);
  return m[1].trim();
}

function readToolWithCommon(skillDir, toolName) {
  const commonPath = path.join(skillDir, "scripts", "_r7_disk_compare_common.js");
  const toolPath = path.join(skillDir, "scripts", `${toolName}.js`);
  let code = "";
  if (fs.existsSync(commonPath)) {
    code += fs.readFileSync(commonPath, "utf8").trim() + "\n\n";
  }
  code += fs.readFileSync(toolPath, "utf8").trim();
  return code;
}

const DISK_ENV = {
  app: {},
  user: {
    R7_DISK_BASE_URL: { title: "Базовый URL Р7-Диска", format: "string" },
    R7_DISK_LOGIN: { title: "Логин", format: "string" },
    R7_DISK_PASSWORD: { title: "Пароль", format: "string", secret: true }
  }
};

const DISK_KV_CAP = {
  required: [
    {
      type: "key-value-storage",
      scope: "$USER",
      operations: ["Get", "Set"]
    }
  ]
};

const DISK_RESOURCES = {
  cpu: 0.3,
  memory: 192,
  timeout: 120,
  network: {
    hosts: ["cddisk.gptz.lad-soft.ru", "cddisk.stand.lad-soft.ru", "cddisk.r7o.ro"]
  }
};

const DISK_TOOL_SPECS = {
  r7_list_disk_templates: {
    description: "Список шаблонов (.md/.docx) в папке templates на Р7-Диске (авто-поиск).",
    schemas: {
      input: {
        type: "object",
        additionalProperties: false,
        properties: {
          host_document_id: {
            type: "integer",
            description: "ID хост-документа из supplement (для определения «Мои документы»)."
          },
          directory_id: {
            type: "integer",
            description: "Опциональный override id папки templates (отладка)."
          }
        }
      },
      output: {
        type: "object",
        additionalProperties: true,
        required: ["ok"],
        properties: {
          ok: { type: "boolean" },
          templates: { type: "array" },
          directory_id: { type: "integer" },
          source: { type: "string" },
          error: { type: "string" }
        }
      }
    },
    resources: { ...DISK_RESOURCES, timeout: 90, cpu: 0.2, memory: 128 }
  },
  r7_fetch_disk_template: {
    description:
      "Скачивает шаблон с Р7-Диска по template_name или document_id, возвращает text (max 150000 байт).",
    schemas: {
      input: {
        type: "object",
        additionalProperties: false,
        properties: {
          template_name: { type: "string" },
          document_id: { type: "integer" }
        }
      },
      output: {
        type: "object",
        additionalProperties: true,
        required: ["ok"],
        properties: {
          ok: { type: "boolean" },
          text: { type: "string" },
          truncated: { type: "boolean" },
          document_id: { type: "integer" },
          file_name: { type: "string" },
          source: { type: "string" },
          error: { type: "string" }
        }
      }
    }
  },
  r7_fetch_disk_document: {
    description:
      "Скачивает хост-документ с Р7-Диска по document_id, возвращает text (max 200000 байт).",
    schemas: {
      input: {
        type: "object",
        additionalProperties: false,
        required: ["document_id"],
        properties: {
          document_id: { type: "integer" },
          file_name: { type: "string" }
        }
      },
      output: {
        type: "object",
        additionalProperties: true,
        required: ["ok"],
        properties: {
          ok: { type: "boolean" },
          text: { type: "string" },
          truncated: { type: "boolean" },
          document_id: { type: "integer" },
          file_name: { type: "string" },
          source: { type: "string" },
          error: { type: "string" }
        }
      }
    }
  }
};

function buildDiskTool(skillDir, toolName) {
  const spec = DISK_TOOL_SPECS[toolName];
  if (!spec) throw new Error("Unknown disk tool: " + toolName);
  return {
    name: toolName,
    description: spec.description,
    runtime: "nodejs@24",
    schemas: spec.schemas,
    capabilities: DISK_KV_CAP,
    environment: DISK_ENV,
    resources: spec.resources || DISK_RESOURCES,
    function: readToolWithCommon(skillDir, toolName)
  };
}

function buildCompareDiskPayload() {
  const slug = "r7-compare-disk";
  return {
    skill: slug,
    title: slug,
    name: slug,
    description:
      "Transport для r7-compare-docs: list/fetch шаблонов и хост-документа через Р7-Диск API.",
    detailed_description: readSkillBody(DISK_SKILL_DIR),
    version: "1.0.0",
    category: "productivity",
    icon: "document",
    tags: ["r7", "compare", "disk"],
    tools: DISK_TOOLS.map((name) => buildDiskTool(DISK_SKILL_DIR, name))
  };
}

function listSkills(search) {
  const q =
    `/v1/application/list?type%5B%5D=skill&return_installed=false&limit=100&offset=0` +
    (search ? `&search=${encodeURIComponent(search)}` : "");
  const resp = run(`req GET "${q}"`);
  return (((resp || {}).data || {}).applications || []).filter(Boolean);
}

function findSkillBySlug(apps, slug) {
  return apps.find((x) => x.name === slug || x.title === slug) || null;
}

function getSkillDetail(catalogId) {
  const resp = run(`req GET "/v1/application/${catalogId}?type=skill&return_installed=false"`);
  const raw = resp && resp.data ? resp.data : resp;
  const data = raw && raw.data ? raw.data : raw;
  if (data && data.id) {
    return { id: data.id, name: data.name || data.title, title: data.title || data.name };
  }
  return null;
}

function resolveSkillBySlug(slug) {
  const hit = findSkillBySlug(listSkills(slug), slug);
  if (hit) return hit;
  const catalogIds = readSkillCatalogIds();
  const catalogId = catalogIds[slug];
  if (!catalogId) return null;
  return getSkillDetail(catalogId);
}

function getRemoteTools(appId) {
  const resp = run(`req GET "/v1/application/${appId}?type=skill&return_installed=false"`);
  return (((resp || {}).data || {}).tools || []).filter(Boolean);
}

function writeTempPayload(slug, payload) {
  const outDir = path.join(CASE_DIR, "payloads");
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  const file = path.join(outDir, `${slug}.publish.json`);
  fs.writeFileSync(file, JSON.stringify(payload, null, 2));
  return file;
}

function upsertSkill(payload) {
  let remote = resolveSkillBySlug(payload.skill);
  const tmp = writeTempPayload(payload.skill, payload);
  try {
    if (!remote) {
      try {
        const created = run(`skill-create "${tmp.replace(/\\/g, "/")}"`);
        return { appId: created.app_id, created: true };
      } catch (err) {
        remote = resolveSkillBySlug(payload.skill);
        if (!remote) throw err;
      }
    }
    const remoteTools = getRemoteTools(remote.id);
    const byName = Object.fromEntries(remoteTools.map((t) => [t.name, t.id]));
    for (const tool of payload.tools) {
      if (byName[tool.name]) tool.id = byName[tool.name];
    }
    fs.writeFileSync(tmp, JSON.stringify(payload, null, 2));
    run(`skill-update ${remote.id} "${tmp.replace(/\\/g, "/")}"`);
    return { appId: remote.id, created: false };
  } finally {
    if (fs.existsSync(tmp)) fs.unlinkSync(tmp);
  }
}

function bindSkill(agentId, appId) {
  return run(`agent-bind ${agentId} ${appId} --install`);
}

function getInstalledId(catalogAppId) {
  const resp = run(`req GET "/v1/application/${catalogAppId}?type=skill&return_installed=true"`);
  const installed = ((resp || {}).data || {}).installed;
  return installed && installed.id ? installed.id : null;
}

function collectAllowedAppIds(agent) {
  const fromDefault = (agent.default_policy && agent.default_policy.allowed_app_ids) || [];
  const fromConfig =
    (agent.config &&
      agent.config.policy &&
      agent.config.policy.session &&
      agent.config.policy.session.allowed_app_ids) ||
    [];
  return [...new Set([...fromDefault, ...fromConfig].filter(Boolean))];
}

function syncAllowedAppIds(agentId, requiredInstalledIds) {
  const get = run(`agent-get ${agentId}`);
  const agent = get.agent || get;
  const current = collectAllowedAppIds(agent);
  const required = [...new Set(requiredInstalledIds.filter(Boolean))];
  const removed = current.filter((id) => !required.includes(id));
  const added = required.filter((id) => !current.includes(id));
  if (removed.length === 0 && added.length === 0) {
    return { updated: false, allowed_app_ids: required, added: [], removed: [] };
  }

  const config = JSON.parse(JSON.stringify(agent.config || { version: 1, policy: {} }));
  if (!config.policy || typeof config.policy !== "object") config.policy = {};
  if (!config.policy.session || typeof config.policy.session !== "object") {
    config.policy.session = {};
  }
  config.policy.session.allowed_app_ids = required;

  const dp = JSON.parse(JSON.stringify(agent.default_policy || { agent_modules: {} }));
  if (!dp.agent_modules || typeof dp.agent_modules !== "object") dp.agent_modules = {};
  dp.allowed_app_ids = required;

  const patchFile = path.join(CASE_DIR, "payloads", "_agent_allowed_apps.patch.json");
  fs.mkdirSync(path.dirname(patchFile), { recursive: true });
  fs.writeFileSync(
    patchFile,
    JSON.stringify({ agent_id: agentId, config, default_policy: dp }, null, 2)
  );
  try {
    run(`req PATCH "/v1/agent/${agentId}" "${patchFile.replace(/\\/g, "/")}"`);
  } finally {
    if (fs.existsSync(patchFile)) fs.unlinkSync(patchFile);
  }

  return { updated: true, allowed_app_ids: mergedIds(required), added, removed };
}

function mergedIds(ids) {
  return [...new Set(ids.filter(Boolean))];
}

function ensureAgentId() {
  const meta = readAgentMeta();
  if (meta && meta.agentId) return meta.agentId;

  const instrPath = path.join(CASE_DIR, "agent", "instruction").replace(/\\/g, "/");
  const created = run(
    `agent-create --title "${AGENT_TITLE}" --instruction-file "${instrPath}" --model ${MODEL_ID}`
  );
  const agentId = created.agent_id || created.id;
  if (!agentId) throw new Error("agent-create did not return agent_id");
  writeAgentMeta({
    agentId,
    title: AGENT_TITLE,
    syncedAt: new Date().toISOString(),
    note: "disk-ref compare agent; helpers from compare-s27"
  });
  return agentId;
}

function patchAgentInstruction(agentId) {
  const instructionFile = path.join(CASE_DIR, "agent", "instruction").replace(/\\/g, "/");
  return run(`agent-patch ${agentId} --instruction-file "${instructionFile}"`);
}

function resolveHelperAppId(slug) {
  const catalog = readSkillCatalogIds();
  const id = catalog[slug];
  if (!id) throw new Error("Missing helper skill catalog id: " + slug);
  const detail = getSkillDetail(id);
  if (!detail) throw new Error("Helper skill not found on prod: " + slug);
  return detail.id;
}

function main() {
  run("auth");

  const agentId = ensureAgentId();
  const compareDisk = upsertSkill(buildCompareDiskPayload());

  const helperSlugs = Object.keys(HELPER_SKILL_IDS);
  const helperAppIds = helperSlugs.map(resolveHelperAppId);

  const binds = [
    bindSkill(agentId, compareDisk.appId),
    ...helperAppIds.map((appId) => bindSkill(agentId, appId))
  ];

  const installedIds = [
    binds[0].installed_application_id || getInstalledId(compareDisk.appId),
    ...helperAppIds.map((appId, i) => binds[i + 1].installed_application_id || getInstalledId(appId))
  ];

  const allowedSync = syncAllowedAppIds(agentId, installedIds);
  patchAgentInstruction(agentId);
  const verify = run(`agent-get ${agentId}`);

  writeSkillCatalogIds({
    "r7-compare-disk": compareDisk.appId,
    ...HELPER_SKILL_IDS
  });

  console.log(
    JSON.stringify(
      {
        ok: true,
        agent_id: agentId,
        published: { "r7-compare-disk": compareDisk },
        helper_skills: HELPER_SKILL_IDS,
        bound: binds.map((x) => ({
          app_id: x.app_id,
          binding_id: x.binding_id,
          status: x.status,
          installed_application_id: x.installed_application_id || null
        })),
        allowed_app_ids: {
          required_installed_ids: installedIds,
          sync: allowedSync,
          current: collectAllowedAppIds(verify.agent || verify)
        },
        agent_title: verify.agent && verify.agent.title ? verify.agent.title : null
      },
      null,
      2
    )
  );
}

main();
