async function handler(state, params) {
  const normalized = await normalizeInput(state, params);
  if (!normalized.ok) return { ok: false, error: normalized.error };

  const bytesResult = await resolveDocxBytes(state, normalized.data);
  if (!bytesResult.ok) return { ok: false, error: bytesResult.error };

  const uploadResult = await uploadDocxToSessionVfs(state, {
    fileName: normalized.data.fileName,
    mimeType: normalized.data.mimeType,
    bytes: bytesResult.data
  });
  if (!uploadResult.ok) return { ok: false, error: uploadResult.error };

  const tasks = [
    {
      type: "deliver_file",
      data: {
        fileId: uploadResult.fileId,
        fileName: normalized.data.fileName,
        mimeType: normalized.data.mimeType,
        actions: normalized.data.actions,
        importAs: null
      }
    }
  ];

  return {
    ok: true,
    fileId: uploadResult.fileId,
    fileName: normalized.data.fileName,
    mimeType: normalized.data.mimeType,
    r7_task: tasks,
    r7_task_block: "```r7.task\n" + JSON.stringify(tasks, null, 2) + "\n```"
  };
}

async function normalizeInput(state, params) {
  const raw = params && typeof params === "object" ? params : {};
  const render = raw.render && typeof raw.render === "object" ? raw.render : null;

  const fileName = sanitizeDocxName(
    pickString(
      raw.fileName,
      render && typeof render.fileName === "string" ? render.fileName : "",
      render && typeof render.localPath === "string" ? baseName(render.localPath) : ""
    ) || "compare-report.docx"
  );
  const mimeType =
    pickString(raw.mimeType, render && typeof render.mimeType === "string" ? render.mimeType : "") ||
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  const contentBase64 = pickString(
    raw.content_base64,
    render && typeof render.content_base64 === "string" ? render.content_base64 : ""
  );
  let localPath = pickString(
    raw.localPath,
    render && typeof render.localPath === "string" ? render.localPath : ""
  );
  const actions = normalizeActions(raw.actions);

  if (!contentBase64 && !localPath) {
    localPath = await findLatestDocxPath(state);
  }
  if (!contentBase64 && !localPath) {
    return { ok: false, error: "Нужен content_base64, localPath или готовый .docx в /workspace/out/." };
  }

  return { ok: true, data: { fileName, mimeType, contentBase64, localPath, actions } };
}

async function resolveDocxBytes(state, input) {
  if (input.contentBase64) {
    const decoded = decodeBase64(input.contentBase64);
    if (!decoded || decoded.length === 0) {
      return { ok: false, error: "Некорректный content_base64." };
    }
    return { ok: true, data: decoded };
  }
  return readBytesFromVfs(state, input.localPath);
}

async function readBytesFromVfs(state, path) {
  const vfs = getVfs(state);
  if (!vfs || typeof vfs.readFile !== "function") {
    return { ok: false, error: "VFS readFile недоступен." };
  }
  try {
    const raw = await vfs.readFile(path);
    const bytes = toByteArray(raw);
    if (!bytes || bytes.length === 0) {
      return { ok: false, error: "DOCX пустой или не найден в VFS." };
    }
    return { ok: true, data: bytes };
  } catch (error) {
    return { ok: false, error: String(error) };
  }
}

async function uploadDocxToSessionVfs(state, payload) {
  const caps = state && state.capabilities && typeof state.capabilities === "object" ? state.capabilities : {};
  const adapters = [];
  if (caps.vfs && typeof caps.vfs === "object") adapters.push(caps.vfs);
  for (const key of ["vfs-session", "sessionVfs", "agentVfs", "session_vfs"]) {
    if (caps[key] && typeof caps[key] === "object") adapters.push(caps[key]);
  }

  for (const adapter of adapters) {
    const uploadFn = pickUpload(adapter);
    if (!uploadFn) continue;
    const fileId = await tryUpload(uploadFn, adapter, payload);
    if (fileId) return { ok: true, fileId };
  }

  return { ok: false, error: "Session upload недоступен. Проверь capability vfs/upload." };
}

async function tryUpload(uploadFn, ctx, payload) {
  const base64 = toBase64(payload.bytes);
  const variants = [
    {
      scope: "session",
      fileName: payload.fileName,
      content: payload.bytes,
      mimeType: payload.mimeType
    },
    {
      scope: "session",
      fileName: payload.fileName,
      content_base64: base64,
      encoding: "base64",
      mimeType: payload.mimeType
    }
  ];

  for (const variant of variants) {
    try {
      const result = await uploadFn.call(ctx, variant);
      const id = extractFileId(result);
      if (id) return id;
    } catch {}
  }
  return "";
}

async function findLatestDocxPath(state) {
  const vfs = getVfs(state);
  if (!vfs || typeof vfs.listDir !== "function") return "";
  try {
    const list = await vfs.listDir("/workspace/out");
    if (!Array.isArray(list)) return "";
    let best = "";
    for (const entry of list) {
      if (!entry || typeof entry !== "object") continue;
      const name = typeof entry.name === "string" ? entry.name.trim() : "";
      const isDir = entry.isDirectory === true || entry.type === "directory";
      if (!name || isDir || !name.toLowerCase().endsWith(".docx")) continue;
      best = name;
    }
    return best ? "/workspace/out/" + best : "";
  } catch {
    return "";
  }
}

function extractFileId(result) {
  if (typeof result === "string" && isUuid(result)) return result;
  if (!result || typeof result !== "object") return "";
  const candidates = [result.file_id, result.fileId, result.id, result.uuid];
  for (const value of candidates) {
    if (typeof value === "string" && isUuid(value)) return value;
  }
  if (result.data && typeof result.data === "object") {
    const nested = [result.data.file_id, result.data.fileId, result.data.id, result.data.uuid];
    for (const value of nested) {
      if (typeof value === "string" && isUuid(value)) return value;
    }
  }
  return "";
}

function pickUpload(adapter) {
  for (const name of ["upload", "uploadFile", "Upload"]) {
    if (typeof adapter[name] === "function") return adapter[name];
  }
  return null;
}

function getVfs(state) {
  return state && state.capabilities && state.capabilities.vfs && typeof state.capabilities.vfs === "object"
    ? state.capabilities.vfs
    : null;
}

function normalizeActions(actions) {
  if (!Array.isArray(actions)) return ["download"];
  const out = actions.map((x) => String(x).trim()).filter(Boolean);
  return out.length ? out : ["download"];
}

function pickString() {
  const args = Array.from(arguments);
  for (const value of args) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

function baseName(path) {
  const value = String(path || "");
  const idx = value.lastIndexOf("/");
  return idx >= 0 ? value.slice(idx + 1) : value;
}

function sanitizeDocxName(name) {
  const value = String(name || "").trim() || "compare-report.docx";
  return value.toLowerCase().endsWith(".docx") ? value : value + ".docx";
}

function decodeBase64(text) {
  try {
    if (typeof Buffer !== "undefined") return new Uint8Array(Buffer.from(text, "base64"));
    const binary = atob(text);
    const out = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i);
    return out;
  } catch {
    return null;
  }
}

function toBase64(bytes) {
  if (typeof Buffer !== "undefined") return Buffer.from(bytes).toString("base64");
  let binary = "";
  for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

function toByteArray(raw) {
  if (raw == null) return null;
  if (raw instanceof Uint8Array) return raw;
  if (typeof Buffer !== "undefined" && Buffer.isBuffer(raw)) return new Uint8Array(raw);
  if (typeof raw === "string") return decodeBase64(raw) || new TextEncoder().encode(raw);
  return null;
}

function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}
