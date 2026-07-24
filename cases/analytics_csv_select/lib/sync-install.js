"use strict";

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const CASE = path.join(__dirname, "..");
const ROOT = path.join(CASE, "..", "..");
const HELPER = path.join(ROOT, ".cursor", "skills", "ladcraft-prod-publish", "scripts", "ladcraft_prod.js");

const CATALOG_ID = "mSXMyvJ2ev2EPMatoIPAd";
const AGENT_ID = "MOVc1GIygOzS9kwKHyo04";
const R7_KEYS = ["R7_DISK_BASE_URL", "R7_DISK_LOGIN", "R7_DISK_PASSWORD"];

function run(cmd) {
  const full = `node "${HELPER}" ${cmd}`;
  return JSON.parse(
    execSync(full, { cwd: ROOT, encoding: "utf8", maxBuffer: 20 * 1024 * 1024 })
  );
}

function flatInstallationForm(installationForm) {
  if (!installationForm || typeof installationForm !== "object") return null;
  const flat = {};
  for (const [key, spec] of Object.entries(installationForm)) {
    if (!spec || typeof spec !== "object") continue;
    const value = spec.value;
    if (value == null || value === "") continue;
    flat[key] = typeof value === "string" ? value.trim() : value;
  }
  return normalizeFlat(flat);
}

function loadInstallDefaults() {
  const filePath = path.join(CASE, "install.defaults.json");
  if (!fs.existsSync(filePath)) return null;
  try {
    return normalizeFlat(JSON.parse(fs.readFileSync(filePath, "utf8")));
  } catch {
    return null;
  }
}

function normalizeFlat(flat) {
  if (!flat || typeof flat !== "object") return null;
  const out = {};
  for (const key of R7_KEYS) {
    const value = flat[key];
    if (typeof value === "string" && value.trim() && value.trim() !== "YOUR_PASSWORD_HERE") {
      out[key] = value.trim();
    }
  }
  if (!out.R7_DISK_BASE_URL || !out.R7_DISK_LOGIN || !out.R7_DISK_PASSWORD) return null;
  out.R7_DISK_BASE_URL = out.R7_DISK_BASE_URL.replace(/\/+$/, "");
  return out;
}

function resolveCredentials(catalogData) {
  return flatInstallationForm(catalogData.installationForm) || loadInstallDefaults();
}

function getCatalogWithInstalled() {
  const resp = run(`req GET "/v1/application/${CATALOG_ID}?type=skill&return_installed=true"`);
  return resp.data || resp;
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

function syncAgentAllowedAppIds(installedId) {
  const get = run(`agent-get ${AGENT_ID}`);
  const agent = get.agent || get;
  const current = collectAllowedAppIds(agent);
  const required = [installedId];
  if (current.length === 1 && current[0] === installedId) {
    return { updated: false, allowed_app_ids: required };
  }

  const config = JSON.parse(JSON.stringify(agent.config || { version: 1, policy: {} }));
  if (!config.policy || typeof config.policy !== "object") config.policy = {};
  if (!config.policy.session || typeof config.policy.session !== "object") {
    config.policy.session = {};
  }
  config.policy.session.allowed_app_ids = required;

  const dp = JSON.parse(JSON.stringify(agent.default_policy || {}));
  dp.allowed_app_ids = required;

  const patchFile = path.join(CASE, ".sync-agent-patch.json");
  fs.writeFileSync(patchFile, JSON.stringify({ agent_id: AGENT_ID, config, default_policy: dp }, null, 2));
  try {
    run(`req PATCH "/v1/agent/${AGENT_ID}" "${patchFile.replace(/\\/g, "/")}"`);
  } finally {
    if (fs.existsSync(patchFile)) fs.unlinkSync(patchFile);
  }
  return { updated: true, allowed_app_ids: required, previous: current };
}

function applySkillConfig(installedId, flat) {
  const formPath = path.join(CASE, ".sync-install-form.json");
  fs.writeFileSync(formPath, JSON.stringify(flat, null, 2));
  try {
    return run(`skill-config ${installedId} "${formPath}"`);
  } finally {
    if (fs.existsSync(formPath)) fs.unlinkSync(formPath);
  }
}

function syncInstallAndAgent() {
  const catalog = getCatalogWithInstalled();
  const installedId = catalog.installed && catalog.installed.id;
  if (!installedId) {
    throw new Error("Навык не установлен в space — подключите analytics_csv_select в UI");
  }

  const flat = resolveCredentials(catalog);
  if (!flat) {
    throw new Error(
      "Нет R7_DISK_*: заполните install.defaults.json или форму в «Созданных»"
    );
  }

  const skillConfig = applySkillConfig(installedId, flat);
  const agentSync = syncAgentAllowedAppIds(installedId);

  return {
    ok: true,
    catalog_id: CATALOG_ID,
    installed_application_id: installedId,
    installed_version: catalog.installed && catalog.installed.installed_version,
    skill_config: skillConfig,
    agent: agentSync,
    credentials_source: flatInstallationForm(catalog.installationForm) ? "catalog" : "install.defaults.json"
  };
}

module.exports = {
  CATALOG_ID,
  AGENT_ID,
  run,
  syncInstallAndAgent,
  resolveCredentials,
  getCatalogWithInstalled
};
