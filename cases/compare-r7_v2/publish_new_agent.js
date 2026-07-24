"use strict";

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const ROOT = path.join(__dirname, "..", "..");
const CASE = __dirname;
const HELPER = path.join(ROOT, ".cursor", "skills", "ladcraft-prod-publish", "scripts", "ladcraft_prod.js");
const MODEL_ID = "4ohPFvIN0OJ48pZUR2wFk"; // minimax-M2.7

const SKILL_MAP = [
  { payload: "r7-compare-toolkit.json", slug: "r7-compare-toolkit-v2", skillDir: "r7-compare-toolkit" },
  { payload: "doc-compare.json", slug: "doc-compare-v2", skillDir: "doc-compare" },
  { payload: "r7-docx-render.json", slug: "r7-docx-render-v2", skillDir: "r7-docx-render" },
];

function prod(cmd) {
  const out = execSync(`node "${HELPER}" ${cmd}`, {
    cwd: ROOT,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  return JSON.parse(out);
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
    const key = scope;
    const prev = vfsByScope.get(key) || { type: "vfs", scope, operations: [] };
    const ops = new Set(prev.operations);
    for (const op of cap.operations || []) ops.add(op);
    vfsByScope.set(key, { type: "vfs", scope, operations: [...ops] });
  }
  return {
    ...tool,
    capabilities: { required: [...other, ...vfsByScope.values()] },
  };
}

function toApiPayload(raw, slug) {
  const body =
    typeof raw.skill === "string" && raw.skill.includes("\n") ? raw.skill : raw.detailed_description || "";
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
    tools: (raw.tools || []).map(normalizeToolCapabilities),
  };
}

function readExistingAppId(skillDir) {
  const p = path.join(CASE, "skills", skillDir, ".from-server.json");
  if (!fs.existsSync(p)) return null;
  try {
    const data = JSON.parse(fs.readFileSync(p, "utf8"));
    return data.app_id || null;
  } catch {
    return null;
  }
}

function instructionForV2() {
  return fs.readFileSync(path.join(CASE, "agent", "instruction"), "utf8");
}

function writeFromServer(skillDir, data) {
  fs.writeFileSync(path.join(CASE, "skills", skillDir, ".from-server.json"), JSON.stringify(data, null, 2) + "\n");
}

function main() {
  execSync("node build_payload.js r7-compare-toolkit", { cwd: CASE, stdio: "inherit" });
  execSync("node build_payload.js doc-compare", { cwd: CASE, stdio: "inherit" });
  execSync("node build_payload.js r7-docx-render", { cwd: CASE, stdio: "inherit" });

  const skills = {};
  for (const item of SKILL_MAP) {
    const raw = JSON.parse(fs.readFileSync(path.join(CASE, "payloads", item.payload), "utf8"));
    const api = toApiPayload(raw, item.slug);
    const tmp = path.join(CASE, "payloads", item.slug + ".api.json");
    fs.writeFileSync(tmp, JSON.stringify(api, null, 2));
    const existingAppId = readExistingAppId(item.skillDir);
    const created = existingAppId
      ? { app_id: existingAppId, reused: true }
      : prod(`skill-create "${tmp.replace(/\\/g, "/")}"`);
    const detail = prod(`skill-get ${created.app_id}`);
    const skill = detail.skill || detail;
    skills[item.slug] = {
      app_id: created.app_id,
      installed_application_id: skill.installed?.id || null,
      version: skill.version || api.version,
      tools: (skill.tools || api.tools).map((t) => t.name),
    };
    writeFromServer(item.skillDir, {
      app_id: created.app_id,
      installed_application_id: skill.installed?.id || null,
      version: skill.version || api.version,
      updated_at: new Date().toISOString().slice(0, 10),
    });
    console.log("skill-created:", item.slug, created.app_id);
  }

  const instrPath = path.join(CASE, "payloads", "agent-instruction-v2.txt");
  fs.writeFileSync(instrPath, instructionForV2(), "utf8");

  const agent = prod(
    `agent-create --title "R7: сравнение документов v2" --instruction-file "${instrPath.replace(/\\/g, "/")}" --model ${MODEL_ID}`
  );
  const agentId = agent.agent_id;
  console.log("agent-created:", agentId);

  for (const item of SKILL_MAP) {
    const bind = prod(`agent-bind ${agentId} ${skills[item.slug].app_id} --install`);
    skills[item.slug].installed_application_id = bind.installed_application_id || skills[item.slug].installed_application_id;
    console.log("bound:", item.slug, bind.binding_id || bind.status);
  }

  fs.writeFileSync(
    path.join(CASE, "agent", ".from-server.json"),
    JSON.stringify(
      {
        agentId,
        title: "R7: сравнение документов v2",
        primaryWorkspaceId: agent.primary_workspace_id,
        modelId: MODEL_ID,
        skills,
        syncedAt: new Date().toISOString(),
      },
      null,
      2
    ) + "\n"
  );

  const verify = prod(`agent-get ${agentId}`);
  console.log(
    JSON.stringify(
      {
        ok: true,
        agent_id: agentId,
        title: verify.agent?.title,
        skills: Object.fromEntries(
          SKILL_MAP.map((s) => [s.slug, { catalog: skills[s.slug].app_id, installed: skills[s.slug].installed_application_id }])
        ),
        untouched_agent: "Tzr2xtBAyU0_jR1az_a8S",
      },
      null,
      2
    )
  );
}

main();
