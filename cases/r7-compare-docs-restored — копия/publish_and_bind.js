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
const AGENT_TITLE = process.env.LC_AGENT_TITLE || "P7-compare";
const SKILL_CATALOG_FILE = path.join(CASE_DIR, "skill-catalog.json");
const AGENT_META_FILE = path.join(CASE_DIR, "agent", ".from-server.json");

const HELPER_SKILL_IDS = {
  "r7-report-actions-s27": "UOYiDhp2FgbLFBQACU3XZ"
};

const DISK_SKILL_DIR = path.join(CASE_DIR, "r7-compare-disk");
const DOCX_SKILL_DIR = path.join(CASE_DIR, "r7-docx-render-s27");
const SAVE_SKILL_DIR = path.join(CASE_DIR, "r7-save-compare-disk-s27");
const REPORT_ACTIONS_SKILL_DIR = path.join(CASE_DIR, "r7-report-actions-s27");
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
  const defaults = {
    "r7-report-actions-s27": "UOYiDhp2FgbLFBQACU3XZ",
    "r7-save-compare-disk-s27": "ilGf97XEZG0xE5saduycA",
    "r7-docx-render-s27": "_Jf1k7iQQS6ynYOkKezKo"
  };
  if (fs.existsSync(SKILL_CATALOG_FILE)) {
    try {
      return { ...defaults, ...JSON.parse(fs.readFileSync(SKILL_CATALOG_FILE, "utf8")), ...HELPER_SKILL_IDS };
    } catch {
      /* ignore */
    }
  }
  return { ...defaults, ...HELPER_SKILL_IDS };
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

function readToolFn(skillDir, toolName) {
  return fs.readFileSync(path.join(skillDir, "scripts", `${toolName}.js`), "utf8").trim();
}

function readWidgetFile(skillDir, fileName) {
  const candidates = [
    path.join(skillDir, "widgets", fileName + ".MD"),
    path.join(skillDir, "widgets", fileName + ".md")
  ];
  const filePath = candidates.find((p) => fs.existsSync(p));
  if (!filePath) throw new Error("Widget file not found: " + fileName);
  const text = fs.readFileSync(filePath, "utf8");
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  if (!m) throw new Error("Invalid widget frontmatter: " + filePath);
  const front = m[1];
  const body = m[2].trim();
  const nameMatch = front.match(/^name:\s*(.+)$/m);
  const descMatch = front.match(/^description:\s*(.+)$/m);
  return {
    name: nameMatch ? nameMatch[1].trim() : fileName,
    description: descMatch ? descMatch[1].trim() : fileName,
    content: body
  };
}

/** Ladcraft publish expects widget template embedded in tools[].widget (object), not a slug string. */
function embedToolWidget(widget) {
  return {
    name: widget.name,
    description: widget.description,
    content: widget.content
  };
}

function readDocxBundle(toolFileName, toolDir) {
  const renderScripts = path.join(DOCX_SKILL_DIR, "scripts");
  let code = "";
  for (const lib of ["_markdown_report.js", "_docx_build.js"]) {
    code += fs.readFileSync(path.join(renderScripts, lib), "utf8").trim() + "\n\n";
  }
  code += fs.readFileSync(path.join(toolDir, toolFileName + ".js"), "utf8").trim();
  return code;
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
    description:
      "Список шаблонов (.md/.docx) в templates; резолв хост-документа по host_file_name в «Мои документы».",
    schemas: {
      input: {
        type: "object",
        additionalProperties: false,
        properties: {
          host_file_name: {
            type: "string",
            description: "Имя хост-документа из supplement (plan B)."
          },
          host_document_id: {
            type: "integer",
            description: "Опциональный id хост-документа, если плагин передал document_id."
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
          host_document_id: { type: "integer" },
          host_file_name: { type: "string" },
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
      "Скачивает хост-документ с Р7-Диска по host_file_name или document_id, возвращает text (max 200000 байт).",
    schemas: {
      input: {
        type: "object",
        additionalProperties: false,
        properties: {
          host_file_name: { type: "string" },
          host_document_id: { type: "integer" },
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
    version: "1.2.9",
    category: "productivity",
    icon: "document",
    tags: ["r7", "compare", "disk"],
    tools: DISK_TOOLS.map((name) => buildDiskTool(DISK_SKILL_DIR, name))
  };
}

function buildDocxRenderPayload() {
  const slug = "r7-docx-render-s27";
  return {
    skill: slug,
    title: slug,
    name: slug,
    description: "DOCX из markdown-отчёта сравнения (таблицы Word) для r7-compare-docs.",
    detailed_description: readSkillBody(DOCX_SKILL_DIR),
    version: "1.1.1",
    category: "productivity",
    icon: "document",
    tags: ["r7", "compare", "docx", "render"],
    tools: [
      {
        name: "r7_render_docx",
        description:
          "Собирает DOCX из markdown-отчёта или CompareReport (doc-compare/v1) в /workspace/out/.",
        runtime: "nodejs@24",
        schemas: {
          input: {
            type: "object",
            additionalProperties: true,
            properties: {
              markdown: { type: "string", description: "Markdown-отчёт сравнения (приоритет)." },
              report: { type: "object", description: "CompareReport doc-compare/v1." }
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
            { type: "vfs", scope: "$USER", operations: ["writeFile", "mkdir"] }
          ]
        },
        environment: { app: {}, user: {} },
        resources: { cpu: 0.3, memory: 192, timeout: 120, network: { hosts: [] } },
        function: readDocxBundle("r7_render_docx", path.join(DOCX_SKILL_DIR, "scripts"))
      }
    ]
  };
}

function buildReportActionsPayload() {
  const slug = "r7-report-actions-s27";
  const widget = readWidgetFile(REPORT_ACTIONS_SKILL_DIR, "r7_show_compare_actions_widget");
  return {
    skill: slug,
    title: slug,
    name: slug,
    description:
      "r7.task и виджет действий для отчёта сравнения — вставка, скачивание md/html, сохранение на диск.",
    detailed_description: readSkillBody(REPORT_ACTIONS_SKILL_DIR),
    version: "6.0.1",
    category: "productivity",
    icon: "document",
    tags: ["r7", "compare", "export", "widget"],
    widgets: [embedToolWidget(widget)],
    tools: [
      {
        name: "r7_prepare_report_actions",
        description:
          "Готовит r7.task для вставки markdown-отчёта и/или скачивания .md/.html в плагине ladcraft-r7.",
        runtime: "nodejs@24",
        schemas: {
          input: {
            type: "object",
            additionalProperties: false,
            required: ["markdown", "mode"],
            properties: {
              markdown: { type: "string", description: "Финальный markdown-отчёт сравнения." },
              mode: {
                type: "string",
                enum: ["insert", "download_md", "both", "download_html"]
              },
              fileName: { type: "string", description: "Имя файла для deliver_inline." }
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
        function: readToolFn(REPORT_ACTIONS_SKILL_DIR, "r7_prepare_report_actions")
      },
      {
        name: "r7_show_compare_actions_widget",
        description: "Виджет с кнопками действий после отчёта сравнения.",
        runtime: "nodejs@24",
        widget: embedToolWidget(widget),
        schemas: {
          input: {
            type: "object",
            additionalProperties: false,
            properties: {}
          },
          output: {
            type: "object",
            additionalProperties: false,
            required: ["ok", "show_widget"],
            properties: {
              ok: { type: "boolean" },
              show_widget: { type: "boolean" }
            }
          }
        },
        capabilities: { required: [] },
        environment: { app: {}, user: {} },
        resources: {
          cpu: 0.1,
          memory: 64,
          timeout: 30,
          network: { hosts: [] }
        },
        function: readToolFn(REPORT_ACTIONS_SKILL_DIR, "r7_show_compare_actions_widget")
      }
    ]
  };
}

function buildSaveCompareDiskPayload() {
  const slug = "r7-save-compare-disk-s27";
  return {
    skill: slug,
    title: slug,
    name: slug,
    description:
      "DOCX отчёта сравнения на Р7-Диск в CompareResults (content_base64 или markdown с таблицами).",
    detailed_description: readSkillBody(SAVE_SKILL_DIR),
    version: "1.2.2",
    category: "productivity",
    icon: "document",
    tags: ["r7", "compare", "disk", "docx"],
    tools: [
      {
        name: "r7_save_compare_report_to_disk",
        description:
          "Login в Р7-Диск, папка CompareResults, upload DOCX с отчётом сравнения.",
        runtime: "nodejs@24",
        schemas: {
          input: {
            type: "object",
            additionalProperties: false,
            properties: {
              content_base64: { type: "string", description: "DOCX из r7_render_docx." },
              markdown: { type: "string", description: "Markdown-отчёт (сборка DOCX с таблицами)." },
              fileName: { type: "string" },
              folderName: { type: "string" },
              folder_id: { type: "integer" }
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
            { type: "key-value-storage", scope: "$USER", operations: ["Get", "Set"] }
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
        function: readDocxBundle(
          "r7_save_compare_report_to_disk",
          path.join(SAVE_SKILL_DIR, "scripts")
        )
      }
    ]
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
  return (
    apps.find((x) => x.name === slug || x.title === slug) ||
    apps.find((x) => (x.title || "").toLowerCase() === slug.toLowerCase()) ||
    null
  );
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
  const searches = [slug, "compare", "disk", ""];
  for (const term of searches) {
    const hit = findSkillBySlug(listSkills(term), slug);
    if (hit) return hit;
  }
  const catalogIds = readSkillCatalogIds();
  const catalogId = catalogIds[slug];
  if (!catalogId) return null;
  try {
    return getSkillDetail(catalogId);
  } catch {
    return null;
  }
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
  if (meta && meta.agentId) {
    const got = safeRun(`agent-get ${meta.agentId}`);
    if (got.ok) return meta.agentId;
  }

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

function safeRun(cmd) {
  try {
    return { ok: true, data: run(cmd) };
  } catch {
    return { ok: false };
  }
}

function patchAgentInstruction(agentId) {
  const instructionFile = path.join(CASE_DIR, "agent", "instruction").replace(/\\/g, "/");
  return run(`agent-patch ${agentId} --instruction-file "${instructionFile}"`);
}

function resolveHelperAppId(slug) {
  const catalog = readSkillCatalogIds();
  const id = catalog[slug];
  if (!id) throw new Error("Missing helper skill catalog id: " + slug);
  try {
    const detail = getSkillDetail(id);
    if (detail) return detail.id;
  } catch {
    /* stale catalog id */
  }
  const hit = findSkillBySlug(listSkills(slug), slug);
  if (hit && hit.id) return hit.id;
  throw new Error("Helper skill not found on prod: " + slug);
}

function main() {
  run("auth");

  const agentId = ensureAgentId();
  const compareDisk = upsertSkill(buildCompareDiskPayload());
  const docxRender = upsertSkill(buildDocxRenderPayload());
  const saveDisk = upsertSkill(buildSaveCompareDiskPayload());
  const reportActions = upsertSkill(buildReportActionsPayload());

  const binds = [
    bindSkill(agentId, compareDisk.appId),
    bindSkill(agentId, docxRender.appId),
    bindSkill(agentId, saveDisk.appId),
    bindSkill(agentId, reportActions.appId)
  ];

  const installedIds = [
    binds[0].installed_application_id || getInstalledId(compareDisk.appId),
    binds[1].installed_application_id || getInstalledId(docxRender.appId),
    binds[2].installed_application_id || getInstalledId(saveDisk.appId),
    binds[3].installed_application_id || getInstalledId(reportActions.appId)
  ];

  const allowedSync = syncAllowedAppIds(agentId, installedIds);
  patchAgentInstruction(agentId);
  const verify = run(`agent-get ${agentId}`);

  writeSkillCatalogIds({
    "r7-compare-disk": compareDisk.appId,
    "r7-docx-render-s27": docxRender.appId,
    "r7-save-compare-disk-s27": saveDisk.appId,
    "r7-report-actions-s27": reportActions.appId
  });

  console.log(
    JSON.stringify(
      {
        ok: true,
        agent_id: agentId,
        published: {
          "r7-compare-disk": compareDisk,
          "r7-docx-render-s27": docxRender,
          "r7-save-compare-disk-s27": saveDisk,
          "r7-report-actions-s27": reportActions
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
