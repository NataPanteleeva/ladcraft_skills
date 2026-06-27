"use strict";

// Self-contained Ladcraft prod helper (no external deps, Node >=18).
// Auth + raw API + the tricky agent lifecycle (import -> install -> find -> patch -> bind).
//
// Credentials/env resolution order (per key): process.env, then .env file.
//   LADCRAFT_EMAIL (fallback LADCRAFT_USERNAME), LADCRAFT_PASSWORD,
//   LADCRAFT_API_URL (default https://api.ladcraft.ru), LADCRAFT_ENV_FILE (default ./.env)
//
// Usage:
//   node ladcraft_prod.js auth
//   node ladcraft_prod.js agent-import <bundle.application.ladcraft> [--title T]
//   node ladcraft_prod.js agent-install <applicationId>
//   node ladcraft_prod.js agent-create --title T (--instruction-file F | --instruction S) [--model M] [--kind K] [--no-workspace]
//   node ladcraft_prod.js agent-list [--title T]
//   node ladcraft_prod.js agent-get <agentId>
//   node ladcraft_prod.js agent-patch <agentId> [--instruction-file F | --instruction S] [--title S]
//   node ladcraft_prod.js agent-policy <agentId> [--max-parallel N] [--join-policy wait_all|wait_until_timeout] [--join-timeout-ms N] [--resume-parent true|false]
//   node ladcraft_prod.js agent-model <agentId> <modelId>
//   node ladcraft_prod.js models [--operation text-generation]
//   node ladcraft_prod.js agent-link <parentId> <workerId> [--type delegates_to]
//   node ladcraft_prod.js agent-bind <agentId> <skillAppId> [--install] [--disabled]
//   node ladcraft_prod.js skill-install <skillAppId> [--form form.json]
//   node ladcraft_prod.js skill-config <installedAppId> <form.json|inlineJson>
//   node ladcraft_prod.js skill-get <appId>
//   node ladcraft_prod.js skill-create <payload.json>
//   node ladcraft_prod.js skill-update <appId> <payload.json>
//   node ladcraft_prod.js req <METHOD> <path> [bodyJsonOrFile]

const fs = require("fs");
const path = require("path");

function loadDotEnv() {
  const file = process.env.LADCRAFT_ENV_FILE || path.resolve(process.cwd(), ".env");
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq === -1) continue;
    const k = t.slice(0, eq).trim();
    let v = t.slice(eq + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (!(k in process.env)) process.env[k] = v;
  }
}

function cfg() {
  loadDotEnv();
  const email = process.env.LADCRAFT_EMAIL || process.env.LADCRAFT_USERNAME;
  const password = process.env.LADCRAFT_PASSWORD;
  const baseUrl = (process.env.LADCRAFT_API_URL || "https://api.ladcraft.ru").replace(/\/$/, "");
  if (!email || !password) throw new Error("Missing LADCRAFT_EMAIL/USERNAME or LADCRAFT_PASSWORD (.env or env)");
  return { email, password, baseUrl };
}

function unwrap(d) {
  return d && typeof d === "object" && d.result !== undefined ? d.result : d;
}

async function api(baseUrl, token, method, p, { query, body } = {}) {
  let url = baseUrl + p;
  if (query) {
    const sp = new URLSearchParams();
    for (const [k, v] of Object.entries(query)) if (v != null) sp.append(k, String(v));
    const q = sp.toString();
    if (q) url += "?" + q;
  }
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  const init = { method, headers };
  if (body !== undefined) {
    headers["Content-Type"] = "application/json";
    init.body = typeof body === "string" ? body : JSON.stringify(body);
  }
  const resp = await fetch(url, init);
  const ct = resp.headers.get("content-type") || "";
  const data = ct.includes("application/json") ? await resp.json() : await resp.text();
  if (!resp.ok) {
    const e = new Error(`HTTP ${resp.status} ${method} ${p}`);
    e.status = resp.status;
    e.data = data;
    throw e;
  }
  return data;
}

async function login() {
  const { email, password, baseUrl } = cfg();
  const data = await api(baseUrl, null, "POST", "/v1/auth/login", {
    body: { email: email.toLowerCase(), password },
  });
  const r = unwrap(data);
  const token = r.access_token || r.token;
  if (!token) throw new Error("No access_token in login response");
  return { baseUrl, token, email };
}

function flag(args, name) {
  const i = args.indexOf(name);
  if (i === -1) return undefined;
  return args[i + 1];
}

async function importAgent(baseUrl, token, bundlePath, title) {
  const buf = fs.readFileSync(bundlePath);
  const fd = new FormData();
  fd.append("file", new Blob([buf], { type: "application/gzip" }), path.basename(bundlePath));
  let url = baseUrl + "/v1/application/import";
  if (title) url += "?title=" + encodeURIComponent(title);
  const resp = await fetch(url, { method: "POST", headers: { Authorization: `Bearer ${token}` }, body: fd });
  const data = await resp.json();
  if (!resp.ok) { const e = new Error(`HTTP ${resp.status} import`); e.status = resp.status; e.data = data; throw e; }
  return unwrap(data);
}

// Install an application into the user's space. A skill must be installed
// before binding to an agent, otherwise the agent shows it as "not connected".
async function installApp(baseUrl, token, appId, type, installationForm) {
  const body = installationForm && Object.keys(installationForm).length > 0 ? { installationForm } : {};
  return unwrap(await api(baseUrl, token, "POST", `/v1/application/space/install/${appId}`, { query: { type }, body }));
}

async function main() {
  const [cmd, ...args] = process.argv.slice(2);
  if (!cmd) throw new Error("Specify a subcommand (see header of this file)");

  if (cmd === "auth") {
    const { baseUrl, email } = await login();
    return { ok: true, base_url: baseUrl, email };
  }

  const { baseUrl, token } = await login();

  switch (cmd) {
    case "agent-import": {
      const bundle = args[0];
      if (!bundle) throw new Error("agent-import <bundle> [--title T]");
      const r = await importAgent(baseUrl, token, bundle, flag(args, "--title"));
      return { ok: true, application_id: r.id, type: r.type };
    }
    case "agent-install": {
      const appId = args[0];
      if (!appId) throw new Error("agent-install <applicationId>");
      const r = unwrap(await api(baseUrl, token, "POST", `/v1/application/space/install/${appId}`, { query: { type: "agent" }, body: {} }));
      return { ok: true, ...r };
    }
    case "agent-create": {
      // Create a LIVE agent directly from an instruction (no bundle/import needed).
      const title = flag(args, "--title");
      if (!title) throw new Error("agent-create --title T (--instruction-file F | --instruction S) [--model M] [--kind K] [--no-workspace]");
      const body = { title, kind: flag(args, "--kind") || "assistant", create_primary_workspace: !args.includes("--no-workspace") };
      const instrFile = flag(args, "--instruction-file");
      const instr = flag(args, "--instruction");
      if (instrFile) body.instruction = fs.readFileSync(instrFile, "utf8");
      else if (instr !== undefined) body.instruction = instr;
      const r = unwrap(await api(baseUrl, token, "POST", "/v1/agent", { body }));
      const agentId = r.agent_id || r.id;
      const model = flag(args, "--model");
      if (model && agentId) await api(baseUrl, token, "PATCH", `/v1/agent/${agentId}`, { body: { agent_id: agentId, default_model: model } });
      return { ok: true, ...r, ...(model ? { default_model: model } : {}) };
    }
    case "models": {
      const op = flag(args, "--operation") || "text-generation";
      const d = unwrap(await api(baseUrl, token, "GET", "/v1/inference/model/available", { query: { required_operation: op } }));
      const items = (d && (d.data || d.items)) || [];
      return { ok: true, models: items.map((m) => ({ id: m.id, name: m.name, external_id: m.external_id, context: m.context_window_tokens })) };
    }
    case "agent-model": {
      const id = args[0];
      const modelId = args[1];
      if (!id || !modelId) throw new Error("agent-model <agentId> <modelId>  (modelId is from `models`, not the display name)");
      const r = unwrap(await api(baseUrl, token, "PATCH", `/v1/agent/${id}`, { body: { agent_id: id, default_model: modelId } }));
      return { ok: true, agent_id: id, default_model: modelId, ...r };
    }
    case "agent-link": {
      // Create a delegation relation (parent -> worker) so the parent can use delegateToAgent(s).
      const parent = args[0];
      const worker = args[1];
      if (!parent || !worker) throw new Error("agent-link <parentId> <workerId> [--type delegates_to]");
      const relType = flag(args, "--type") || "delegates_to";
      const r = unwrap(await api(baseUrl, token, "POST", `/v1/agent/${parent}/relations/batch`, {
        body: { delete_relation_ids: [], create_items: [{ target_agent_id: worker, relation_type: relType }] },
      }));
      return { ok: true, ...r };
    }
    case "agent-list": {
      const title = flag(args, "--title");
      const r = unwrap(await api(baseUrl, token, "GET", "/v1/agent", { query: { limit: 50, offset: 0 } }));
      let items = r.items || [];
      if (title) items = items.filter((a) => a.title === title);
      return { ok: true, agents: items.map((a) => ({ agent_id: a.agent_id, title: a.title, status: a.status, created_at: a.created_at, primary_workspace_id: a.primary_workspace_id })) };
    }
    case "agent-get": {
      const id = args[0];
      if (!id) throw new Error("agent-get <agentId>");
      return { ok: true, agent: unwrap(await api(baseUrl, token, "GET", `/v1/agent/${id}`)) };
    }
    case "agent-patch": {
      const id = args[0];
      if (!id) throw new Error("agent-patch <agentId> [--instruction-file F | --instruction S] [--title S]");
      const body = { agent_id: id };
      const instrFile = flag(args, "--instruction-file");
      const instr = flag(args, "--instruction");
      const title = flag(args, "--title");
      if (instrFile) body.instruction = fs.readFileSync(instrFile, "utf8");
      else if (instr !== undefined) body.instruction = instr;
      if (title !== undefined) body.title = title;
      if (Object.keys(body).length === 1) throw new Error("Nothing to patch (pass --instruction[-file] and/or --title)");
      const r = unwrap(await api(baseUrl, token, "PATCH", `/v1/agent/${id}`, { body }));
      return { ok: true, ...r };
    }
    case "agent-policy": {
      // Set delegation policy (BETA "Расширенные настройки"). Read-before-write: mutate the
      // delegation subtree in BOTH config.policy.delegation and default_policy.agent_modules.delegation
      // (that is what the UI saves; verified field: delegation.max_parallel_runs).
      const id = args[0];
      if (!id) throw new Error("agent-policy <agentId> [--max-parallel N] [--join-policy wait_all|wait_until_timeout] [--join-timeout-ms N] [--resume-parent true|false]");
      const a = unwrap(await api(baseUrl, token, "GET", `/v1/agent/${id}`));
      const config = a.config && typeof a.config === "object" ? a.config : { version: 1, policy: {} };
      if (!config.policy || typeof config.policy !== "object") config.policy = {};
      const dp = a.default_policy && typeof a.default_policy === "object" ? a.default_policy : { agent_modules: {} };
      if (!dp.agent_modules || typeof dp.agent_modules !== "object") dp.agent_modules = {};
      const patch = {};
      const mp = flag(args, "--max-parallel");
      const jp = flag(args, "--join-policy");
      const jt = flag(args, "--join-timeout-ms");
      const rp = flag(args, "--resume-parent");
      if (mp !== undefined) patch.max_parallel_runs = Number(mp);
      if (jp !== undefined) patch.join_policy = jp;
      if (jt !== undefined) patch.join_timeout_ms = Number(jt);
      if (rp !== undefined) patch.resume_parent_on_completion = rp === "true";
      if (Object.keys(patch).length === 0) throw new Error("Nothing to set (pass --max-parallel / --join-policy / --join-timeout-ms / --resume-parent)");
      config.policy.delegation = { ...(config.policy.delegation || {}), ...patch };
      dp.agent_modules.delegation = { ...(dp.agent_modules.delegation || {}), ...patch };
      const r = unwrap(await api(baseUrl, token, "PATCH", `/v1/agent/${id}`, { body: { agent_id: id, config, default_policy: dp } }));
      return { ok: true, agent_id: id, delegation: config.policy.delegation, updated_at: r.updated_at };
    }
    case "skill-install": {
      const appId = args[0];
      if (!appId) throw new Error("skill-install <skillAppId> [--form form.json]");
      const formFile = flag(args, "--form");
      const form = formFile ? JSON.parse(fs.readFileSync(formFile, "utf8")) : {};
      const r = await installApp(baseUrl, token, appId, "skill", form);
      return { ok: true, ...r };
    }
    case "skill-config": {
      // Set environment.user (install-time) values on an ALREADY-installed skill.
      // NB: this is a PATCH on the INSTALLED application id (not the catalog appId),
      // and the body is a FLAT { KEY: value } map. POST .../install with a form does
      // NOT persist these values. Get the installed id from skill-install / agent-bind --install.
      const installedId = args[0];
      const formArg = args[1];
      if (!installedId || !formArg) throw new Error("skill-config <installedAppId> <form.json|inlineJson> (flat {KEY:value} map)");
      const form = fs.existsSync(formArg) ? JSON.parse(fs.readFileSync(formArg, "utf8")) : JSON.parse(formArg);
      const r = unwrap(await api(baseUrl, token, "PATCH", `/v1/application/space/install/${installedId}`, { query: { type: "skill" }, body: { installationForm: form } }));
      return { ok: true, installed_application_id: installedId, ...r };
    }
    case "agent-bind": {
      const id = args[0];
      const appId = args[1];
      if (!id || !appId) throw new Error("agent-bind <agentId> <skillAppId> [--install] [--disabled]");
      const enabled = !args.includes("--disabled");
      let installed;
      if (args.includes("--install")) installed = await installApp(baseUrl, token, appId, "skill", {});
      const r = unwrap(await api(baseUrl, token, "POST", `/v1/agent/${id}/apps`, { body: { agent_id: id, app_id: appId, enabled } }));
      return { ok: true, ...r, ...(installed ? { installed_application_id: installed.installed_application_id } : {}) };
    }
    case "skill-get": {
      const appId = args[0];
      if (!appId) throw new Error("skill-get <appId>");
      const r = unwrap(await api(baseUrl, token, "GET", `/v1/application/${appId}`, { query: { type: "skill", return_installed: false } }));
      return { ok: true, id: r.id, title: r.title || r.name, status: r.status, version: r.version, tools: (r.tools || []).map((t) => ({ name: t.name, id: t.id })) };
    }
    case "skill-create": {
      const payloadFile = args[0];
      if (!payloadFile) throw new Error("skill-create <payload.json>");
      const payload = JSON.parse(fs.readFileSync(payloadFile, "utf8"));
      payload.status = "private";
      const r = unwrap(await api(baseUrl, token, "POST", "/v1/application/skill", { body: payload }));
      return { ok: true, app_id: r.id, status: "private" };
    }
    case "skill-update": {
      const appId = args[0];
      const payloadFile = args[1];
      if (!appId || !payloadFile) throw new Error("skill-update <appId> <payload.json>");
      const payload = JSON.parse(fs.readFileSync(payloadFile, "utf8"));
      const r = unwrap(await api(baseUrl, token, "PATCH", `/v1/application/skill/${appId}`, { body: payload }));
      return { ok: true, app_id: appId, version: r.version ?? null };
    }
    case "req": {
      const [method, p, bodyArg] = args;
      if (!method || !p) throw new Error("req <METHOD> <path> [bodyJsonOrFile]");
      let body;
      if (bodyArg) body = fs.existsSync(bodyArg) ? JSON.parse(fs.readFileSync(bodyArg, "utf8")) : JSON.parse(bodyArg);
      return { ok: true, data: unwrap(await api(baseUrl, token, method.toUpperCase(), p, { body })) };
    }
    default:
      throw new Error(`Unknown subcommand: ${cmd}`);
  }
}

main()
  .then((out) => process.stdout.write(JSON.stringify(out, null, 2) + "\n"))
  .catch((e) => {
    process.stderr.write(`FAILED: ${e.message}\n` + (e.data ? JSON.stringify(e.data, null, 2) + "\n" : (e.stack || "") + "\n"));
    process.exit(1);
  });
