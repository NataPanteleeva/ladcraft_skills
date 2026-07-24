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

const AGENT_ID = "s_eDSWr8EkRPfDsbgBJxa";
const DOCX_SKILL_DIR = path.join(ROOT, "cases", "common_skills", "r7-docx-render");
const SKILL_CATALOG_FILE = path.join(CASE_DIR, "skill-catalog.json");

/** Fallback when /application/list search misses private skills. */
const DEFAULT_SKILL_CATALOG_IDS = {
  "r7-report-actions-s27": "VXJisfG60TRXVBceXr0it",
  "r7-export-compare-s27": "sBsa3PBF1N_Hq3IWZUFug",
  "r7-save-compare-disk-s27": "xb_Sj95uLF1KvKPSDBA7y",
  "r7-docx-render": "UHOuXEcDX0QYUuEXSuS8T"
};

function readSkillCatalogIds() {
  if (fs.existsSync(SKILL_CATALOG_FILE)) {
    try {
      return { ...DEFAULT_SKILL_CATALOG_IDS, ...JSON.parse(fs.readFileSync(SKILL_CATALOG_FILE, "utf8")) };
    } catch {
      /* ignore */
    }
  }
  return { ...DEFAULT_SKILL_CATALOG_IDS };
}

function writeSkillCatalogIds(map) {
  fs.mkdirSync(path.dirname(SKILL_CATALOG_FILE), { recursive: true });
  fs.writeFileSync(SKILL_CATALOG_FILE, JSON.stringify(map, null, 2) + "\n");
}

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

function readSkillBody(skillDir) {
  const text = fs.readFileSync(path.join(skillDir, "SKILL.md"), "utf8");
  const m = text.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n([\s\S]*)$/);
  if (!m) throw new Error("Invalid SKILL.md frontmatter: " + skillDir);
  return m[1].trim();
}

function readToolFn(skillDir, toolName) {
  return fs.readFileSync(path.join(skillDir, "scripts", `${toolName}.js`), "utf8").trim();
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

function safeRun(cmd) {
  try {
    return { ok: true, data: run(cmd) };
  } catch (err) {
    return { ok: false, error: err };
  }
}

function getSkillDetail(catalogId) {
  const resp = safeRun(`req GET "/v1/application/${catalogId}?type=skill&return_installed=false"`);
  if (!resp.ok) return null;
  const raw = resp.data;
  const data = raw && raw.data ? raw.data : raw;
  if (data && data.id) {
    return { id: data.id, name: data.name || data.title, title: data.title || data.name };
  }
  return null;
}

function resolveSkillBySlug(slug) {
  const searches = [slug, "s27", "compare", ""];
  for (const term of searches) {
    const hit = findSkillBySlug(listSkills(term), slug);
    if (hit) return hit;
  }
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

function buildReportActionsPayload() {
  const slug = "r7-report-actions-s27";
  const skillDir = path.join(CASE_DIR, "r7-report-actions");
  return {
    skill: slug,
    title: slug,
    name: slug,
    description:
      "Готовит r7.task для отчета сравнения — вставка в документ и скачивание markdown.",
    detailed_description: readSkillBody(skillDir),
    version: "1.0.0",
    category: "productivity",
    icon: "document",
    tags: ["r7", "compare", "export"],
    tools: [
      {
        name: "r7_prepare_report_actions",
        description:
          "Готовит r7.task для вставки markdown-отчета и/или скачивания .md в плагине ladcraft-r7.",
        runtime: "nodejs@24",
        schemas: {
          input: {
            type: "object",
            additionalProperties: false,
            required: ["markdown", "mode"],
            properties: {
              markdown: { type: "string", description: "Финальный markdown-отчет сравнения." },
              mode: { type: "string", enum: ["insert", "download_md", "both"] },
              fileName: { type: "string", description: "Имя файла для deliver_inline (.md)." }
            }
          },
          output: {
            type: "object",
            additionalProperties: true,
            required: ["ok"],
            properties: {
              ok: { type: "boolean" },
              mode: { type: "string" },
              fileName: { type: "string" },
              r7_task: { type: "array" },
              r7_task_block: { type: "string" },
              error: { type: "string" },
              agent_message: { type: "string" }
            }
          }
        },
        capabilities: { required: [] },
        environment: { app: {}, user: {} },
        resources: {
          cpu: 0.2,
          memory: 128,
          timeout: 60,
          network: { hosts: [] }
        },
        function: readToolFn(skillDir, "r7_prepare_report_actions")
      }
    ]
  };
}

function buildSaveCompareDiskPayload() {
  const slug = "r7-save-compare-disk-s27";
  const skillDir = path.join(CASE_DIR, "r7-save-compare-disk-s27");
  return {
    skill: slug,
    title: slug,
    name: slug,
    description:
      "Сохраняет markdown-отчёт сравнения на Р7-Диск в папку CompareResults как DOCX.",
    detailed_description: readSkillBody(skillDir),
    version: "1.0.0",
    category: "productivity",
    icon: "document",
    tags: ["r7", "compare", "disk", "docx"],
    tools: [
      {
        name: "r7_save_compare_report_to_disk",
        description:
          "Login в Р7-Диск (environment), папка CompareResults, загрузка DOCX с отчётом сравнения.",
        runtime: "nodejs@24",
        schemas: {
          input: {
            type: "object",
            additionalProperties: false,
            required: ["markdown"],
            properties: {
              markdown: { type: "string", description: "Финальный markdown-отчёт сравнения." },
              fileName: { type: "string", description: "Имя DOCX." },
              folderName: { type: "string", description: "Имя папки (по умолчанию CompareResults)." }
            }
          },
          output: {
            type: "object",
            additionalProperties: true,
            required: ["ok"],
            properties: {
              ok: { type: "boolean" },
              folder_name: { type: "string" },
              folder_id: { type: "integer" },
              file_name: { type: "string" },
              document_id: { type: "integer" },
              web_ui_hint: { type: "string" },
              agent_message: { type: "string" },
              error: { type: "string" }
            }
          }
        },
        capabilities: {
          required: [
            {
              type: "key-value-storage",
              scope: "$USER",
              operations: ["Get", "Set"]
            }
          ]
        },
        environment: {
          app: {},
          user: {
            R7_DISK_BASE_URL: { title: "Базовый URL Р7-Диска", format: "string" },
            R7_DISK_LOGIN: { title: "Логин", format: "string" },
            R7_DISK_PASSWORD: { title: "Пароль", format: "string", secret: true }
          }
        },
        resources: {
          cpu: 0.3,
          memory: 192,
          timeout: 120,
          network: {
            hosts: ["cddisk.gptz.lad-soft.ru", "cddisk.stand.lad-soft.ru", "cddisk.r7o.ro"]
          }
        },
        function: readToolFn(skillDir, "r7_save_compare_report_to_disk")
      }
    ]
  };
}

function buildDocxRenderPayload() {
  const slug = "r7-docx-render";
  return {
    skill: slug,
    title: slug,
    name: slug,
    description:
      "Собирает .docx из CompareReport JSON через tool r7_render_docx — без python/bash. Для r7-export deliver_file.",
    detailed_description: readSkillBody(DOCX_SKILL_DIR),
    version: "1.0.0",
    category: "productivity",
    icon: "document",
    tags: ["r7", "compare", "docx", "render"],
    tools: [
      {
        name: "r7_render_docx",
        description:
          "Собирает DOCX из CompareReport (doc-compare/v1) в /workspace/out/. Без python-docx и pandoc.",
        runtime: "nodejs@24",
        schemas: {
          input: {
            type: "object",
            additionalProperties: true,
            properties: {
              report: {
                type: "object",
                description: "CompareReport из doc-compare (schema doc-compare/v1)."
              },
              title: { type: "string" },
              sections: { type: "array" },
              outputFileName: { type: "string" },
              suggestedFileName: { type: "string" }
            }
          },
          output: {
            type: "object",
            additionalProperties: true,
            required: ["ok"],
            properties: {
              ok: { type: "boolean" },
              content_base64: { type: "string" },
              localPath: { type: "string" },
              fileName: { type: "string" },
              mimeType: { type: "string" },
              error: { type: "string" },
              agent_message: { type: "string" }
            }
          }
        },
        capabilities: {
          required: [
            {
              type: "vfs",
              scope: "$USER",
              operations: ["writeFile", "mkdir"]
            }
          ]
        },
        environment: { app: {}, user: {} },
        resources: {
          cpu: 0.3,
          memory: 192,
          timeout: 120,
          network: { hosts: [] }
        },
        function: readToolFn(DOCX_SKILL_DIR, "r7_render_docx")
      }
    ]
  };
}

function buildExportComparePayload() {
  const slug = "r7-export-compare-s27";
  const skillDir = path.join(CASE_DIR, "r7-export-compare");
  return {
    skill: slug,
    title: slug,
    name: slug,
    description: "Доставка DOCX отчета сравнения в R7 через session VFS и r7.task deliver_file.",
    detailed_description: readSkillBody(skillDir),
    version: "1.0.0",
    category: "productivity",
    icon: "document",
    tags: ["r7", "compare", "docx", "export"],
    tools: [
      {
        name: "r7_deliver_docx",
        description: "Загружает DOCX в session VFS и возвращает r7.task deliver_file с реальным fileId.",
        runtime: "nodejs@24",
        schemas: {
          input: {
            type: "object",
            additionalProperties: true,
            properties: {
              content_base64: { type: "string" },
              localPath: { type: "string" },
              fileName: { type: "string" },
              mimeType: { type: "string" },
              actions: { type: "array", items: { type: "string" } },
              render: { type: "object", description: "Полный ответ r7_render_docx." }
            }
          },
          output: {
            type: "object",
            additionalProperties: true,
            required: ["ok"],
            properties: {
              ok: { type: "boolean" },
              fileId: { type: "string" },
              fileName: { type: "string" },
              mimeType: { type: "string" },
              r7_task: { type: "array" },
              r7_task_block: { type: "string" },
              error: { type: "string" }
            }
          }
        },
        capabilities: {
          required: [
            {
              type: "vfs",
              scope: "$USER",
              operations: ["readFile", "listDir"]
            },
            {
              type: "vfs",
              scope: "$USER",
              operations: ["upload", "uploadFile"]
            }
          ]
        },
        environment: { app: {}, user: {} },
        resources: {
          cpu: 0.3,
          memory: 192,
          timeout: 120,
          network: { hosts: [] }
        },
        function: readToolFn(skillDir, "r7_deliver_docx")
      }
    ]
  };
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
    if (!remote) {
      throw new Error(`Skill not found after create conflict: ${payload.skill}`);
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

  const merged = required;
  const config = JSON.parse(JSON.stringify(agent.config || { version: 1, policy: {} }));
  if (!config.policy || typeof config.policy !== "object") config.policy = {};
  if (!config.policy.session || typeof config.policy.session !== "object") {
    config.policy.session = {};
  }
  config.policy.session.allowed_app_ids = merged;

  const dp = JSON.parse(JSON.stringify(agent.default_policy || { agent_modules: {} }));
  if (!dp.agent_modules || typeof dp.agent_modules !== "object") dp.agent_modules = {};
  dp.allowed_app_ids = merged;

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

  return { updated: true, allowed_app_ids: merged, added, removed };
}

function patchAgentInstruction(agentId) {
  const instructionFile = path.join(CASE_DIR, "agent", "instruction").replace(/\\/g, "/");
  return run(`agent-patch ${agentId} --instruction-file "${instructionFile}"`);
}

function main() {
  run("auth");

  const reportActions = upsertSkill(buildReportActionsPayload());
  const exportCompare = upsertSkill(buildExportComparePayload());
  const saveCompareDisk = upsertSkill(buildSaveCompareDiskPayload());
  const docxRender = upsertSkill(buildDocxRenderPayload());

  const binds = [
    bindSkill(AGENT_ID, reportActions.appId),
    bindSkill(AGENT_ID, exportCompare.appId),
    bindSkill(AGENT_ID, saveCompareDisk.appId),
    bindSkill(AGENT_ID, docxRender.appId)
  ];

  const installedIds = [
    binds[0].installed_application_id || getInstalledId(reportActions.appId),
    binds[1].installed_application_id || getInstalledId(exportCompare.appId),
    binds[2].installed_application_id || getInstalledId(saveCompareDisk.appId),
    binds[3].installed_application_id || getInstalledId(docxRender.appId)
  ];

  const allowedSync = syncAllowedAppIds(AGENT_ID, installedIds);
  patchAgentInstruction(AGENT_ID);
  const verify = run(`agent-get ${AGENT_ID}`);

  writeSkillCatalogIds({
    "r7-report-actions-s27": reportActions.appId,
    "r7-export-compare-s27": exportCompare.appId,
    "r7-save-compare-disk-s27": saveCompareDisk.appId,
    "r7-docx-render": docxRender.appId
  });

  console.log(
    JSON.stringify(
      {
        ok: true,
        agent_id: AGENT_ID,
        published: {
          "r7-report-actions-s27": reportActions,
          "r7-export-compare-s27": exportCompare,
          "r7-save-compare-disk-s27": saveCompareDisk,
          "r7-docx-render": docxRender
        },
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
