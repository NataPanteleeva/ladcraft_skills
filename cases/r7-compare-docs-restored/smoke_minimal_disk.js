"use strict";

/**
 * Smoke: minimal disk client data (contract check + optional live API).
 *
 *   node cases/r7-compare-docs/smoke_minimal_disk.js --check-contract
 *   R7_DISK_* + R7_HOST_DOCUMENT_ID=12345 node cases/r7-compare-docs/smoke_minimal_disk.js
 */

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const CASE_DIR = __dirname;
const COMMON_PATH = path.join(
  CASE_DIR,
  "r7-compare-disk",
  "scripts",
  "_r7_disk_compare_common.js"
);
const LIST_PATH = path.join(CASE_DIR, "r7-compare-disk", "scripts", "r7_list_disk_templates.js");

function loadHandler(commonPath, toolPath) {
  const common = fs.readFileSync(commonPath, "utf8");
  const tool = fs.readFileSync(toolPath, "utf8");
  const sandbox = { fetch: global.fetch, TextEncoder: global.TextEncoder, TextDecoder: global.TextDecoder };
  vm.createContext(sandbox);
  vm.runInContext(common + "\n" + tool, sandbox);
  if (typeof sandbox.handler !== "function") {
    throw new Error("handler not found in " + toolPath);
  }
  return sandbox.handler;
}

function checkContractFiles() {
  const mustNotContain = "R7_COMPARE_TEMPLATES_DIRECTORY_ID";
  const forbiddenInSupplement = "templates_directory_id";
  const files = [
    path.join(CASE_DIR, "r7-compare-disk", "SKILL.md"),
    path.join(CASE_DIR, "r7-compare-disk", "scripts", "r7_list_disk_templates.meta.md"),
    path.join(CASE_DIR, "publish_and_bind.js"),
    path.join(CASE_DIR, "docs", "r7-disk-ref-contract.md"),
    path.join(CASE_DIR, "..", "plugin", "ladcraft-r7", "src", "transfer", "disk-ref.ts")
  ];
  const errors = [];
  for (const file of files) {
    const text = fs.readFileSync(file, "utf8");
    if (file.includes("publish_and_bind") && text.includes("R7_COMPARE_TEMPLATES_DIRECTORY_ID")) {
      errors.push(file + " still references " + mustNotContain);
    }
    if (file.includes("SKILL.md") && text.includes(mustNotContain)) {
      errors.push(file + " still references " + mustNotContain);
    }
    if (file.includes("meta.md") && text.includes(mustNotContain)) {
      errors.push(file + " still references " + mustNotContain);
    }
    if (file.includes("disk-ref.ts") && text.includes(forbiddenInSupplement)) {
      errors.push(file + " still emits " + forbiddenInSupplement);
    }
    if (file.includes("r7-disk-ref-contract.md") && text.includes(forbiddenInSupplement + ":")) {
      errors.push(file + " still documents supplement field " + forbiddenInSupplement);
    }
  }
  const instruction = fs.readFileSync(path.join(CASE_DIR, "agent", "instruction"), "utf8");
  if (instruction.includes("templates_directory_id")) {
    errors.push("agent/instruction still references templates_directory_id");
  }
  if (!instruction.includes("host_document_id")) {
    errors.push("agent/instruction missing host_document_id");
  }
  const contract = fs.readFileSync(path.join(CASE_DIR, "docs", "r7-disk-ref-contract.md"), "utf8");
  if (contract.includes("templates_directory_id:")) {
    errors.push("contract still documents templates_directory_id in supplement");
  }
  if (!contract.includes("r7-disk:{document_id}")) {
    errors.push("contract must document r7-disk:{id} as primary file_id");
  }
  if (contract.includes("plan B — основной")) {
    errors.push("contract still marks plan B as primary");
  }
  if (!contract.includes("папка **`templates`**")) {
    errors.push("contract missing templates folder requirement");
  }
  return errors;
}

function mockState(envUser) {
  const store = new Map();
  return {
    environment: { user: envUser },
    capabilities: {
      "key-value-storage": {
        get: (k) => (store.has(k) ? store.get(k) : null),
        set: (k, v) => store.set(k, String(v))
      }
    },
    _store: store
  };
}

async function runLive() {
  const baseUrl = (process.env.R7_DISK_BASE_URL || "").replace(/\/+$/, "");
  const login = process.env.R7_DISK_LOGIN || "";
  const password = process.env.R7_DISK_PASSWORD || "";
  const hostDocumentId = Number(process.env.R7_HOST_DOCUMENT_ID || 0);

  if (!baseUrl || !login || !password) {
    console.error("Set R7_DISK_BASE_URL, R7_DISK_LOGIN, R7_DISK_PASSWORD");
    process.exit(2);
  }

  const handler = loadHandler(COMMON_PATH, LIST_PATH);
  const state = mockState({
    R7_DISK_BASE_URL: baseUrl,
    R7_DISK_LOGIN: login,
    R7_DISK_PASSWORD: password
  });

  const params =
    hostDocumentId > 0 ? { host_document_id: hostDocumentId } : {};
  const result = await handler(state, params);
  console.log(JSON.stringify(result, null, 2));

  if (!result.ok) process.exit(1);
  if (!result.my_documents_directory_id) {
    console.error("FAIL: my_documents_directory_id not set");
    process.exit(1);
  }
  const cachedMyDocs = state._store.get("r7_disk_my_documents_directory_id");
  if (!cachedMyDocs) {
    console.error("FAIL: skillStorage missing my_documents cache");
    process.exit(1);
  }
  const cachedTemplates = state._store.get("r7_disk_templates_directory_id");
  if (!cachedTemplates) {
    console.error("FAIL: skillStorage missing templates cache");
    process.exit(1);
  }
  const cachedTemplateIds = state._store.get("r7_disk_template_document_ids");
  if (!cachedTemplateIds) {
    console.error("FAIL: skillStorage missing template document ids cache");
    process.exit(1);
  }
  try {
    const ids = JSON.parse(cachedTemplateIds);
    if (!Array.isArray(ids)) throw new Error("not array");
  } catch {
    console.error("FAIL: r7_disk_template_document_ids is not valid JSON array");
    process.exit(1);
  }
  console.log("OK: live list + auto templates + cache");
}

async function main() {
  const errors = checkContractFiles();
  if (errors.length) {
    console.error("Contract check FAILED:\n" + errors.join("\n"));
    process.exit(1);
  }
  console.log("OK: contract files (no install-time templates env, no supplement templates id)");

  if (process.argv.includes("--check-contract")) {
    return;
  }

  await runLive();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
