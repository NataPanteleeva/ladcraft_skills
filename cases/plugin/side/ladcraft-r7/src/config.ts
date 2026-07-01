/** Plugin runtime configuration (override via localStorage). */

import type { TransferProfile } from "./transfer/types";

export interface PluginConfig {
  baseUrl: string;
  selectedAgentId: string;
}

/** @deprecated Per-agent templates folder id — skill auto-finds `templates` under «Мои документы». */
export interface AgentDiskConfig {
  templatesDirectoryId: number;
}

const STORAGE_KEY = "ladcraft_r7_plugin_config";
const AGENT_DISK_STORAGE_KEY = "ladcraft_r7_agent_disk_config";
const TRANSFER_PROFILE_KEY_PREFIX = "ladcraft_r7_transfer_profile:";

/** Agents that use r7-disk:{id} without VFS upload (r7-compare-docs). */
const DISK_REF_AGENT_IDS = new Set<string>([
  "8UrXveY9LqY8gSmHl2OpM",
  "H3ELtOY2uyYcFQwCAgMst",
]);

/** Agents that explicitly need session VFS snapshot upload (legacy compare).
 *  Requires VFS-capable skills bound to the agent — see docs/01-transfer-rules.md § VFS opt-in. */
const VFS_SNAPSHOT_AGENT_IDS = new Set<string>([
  "s_eDSWr8EkRPfDsbgBJxa",
]);

const DEFAULT_CONFIG: PluginConfig = {
  baseUrl: "https://api.ladcraft.ru",
  selectedAgentId: "",
};

/** @deprecated Skill auto-finds templates folder; kept for backward-compatible localStorage reads. */
export function getAgentDiskConfig(agentId: string): AgentDiskConfig | null {
  if (!agentId) return null;
  try {
    const raw = localStorage.getItem(AGENT_DISK_STORAGE_KEY);
    if (!raw) return null;
    const map = JSON.parse(raw) as Record<string, AgentDiskConfig>;
    const entry = map[agentId];
    if (!entry || typeof entry.templatesDirectoryId !== "number") return null;
    if (!Number.isFinite(entry.templatesDirectoryId) || entry.templatesDirectoryId <= 0) {
      return null;
    }
    return { templatesDirectoryId: Math.floor(entry.templatesDirectoryId) };
  } catch {
    return null;
  }
}

/** @deprecated Skill auto-finds templates folder. */
export function saveAgentDiskConfig(agentId: string, config: AgentDiskConfig): void {
  if (!agentId) return;
  let map: Record<string, AgentDiskConfig> = {};
  try {
    const raw = localStorage.getItem(AGENT_DISK_STORAGE_KEY);
    if (raw) map = JSON.parse(raw) as Record<string, AgentDiskConfig>;
  } catch {
    map = {};
  }
  map[agentId] = {
    templatesDirectoryId: Math.floor(config.templatesDirectoryId),
  };
  localStorage.setItem(AGENT_DISK_STORAGE_KEY, JSON.stringify(map));
}

/** Per-agent transfer profile override in localStorage (doc-compare | disk-ref). */
export function getAgentTransferProfileOverride(agentId: string): TransferProfile | null {
  if (!agentId) return null;
  try {
    const raw = localStorage.getItem(TRANSFER_PROFILE_KEY_PREFIX + agentId);
    if (raw === "doc-compare" || raw === "disk-ref" || raw === "editor-mount") {
      return raw;
    }
  } catch {
    /* ignore */
  }
  return null;
}

/** Persist per-agent transfer profile override. */
export function saveAgentTransferProfileOverride(
  agentId: string,
  profile: TransferProfile,
): void {
  if (!agentId) return;
  localStorage.setItem(TRANSFER_PROFILE_KEY_PREFIX + agentId, profile);
}

export function usesVfsSnapshot(profile: TransferProfile): boolean {
  return profile === "doc-compare";
}

export function usesDiskRef(profile: TransferProfile): boolean {
  return profile === "disk-ref";
}

/** disk-ref only for r7-compare-docs; default doc-compare (VFS) for R7 compare agents. */
export function resolveTransferProfile(agentId: string, agentTitle?: string): TransferProfile {
  const override = getAgentTransferProfileOverride(agentId);
  if (override) return override;

  if (agentId && DISK_REF_AGENT_IDS.has(agentId)) {
    return "disk-ref";
  }

  const title = (agentTitle ?? "").toLowerCase();
  if (title.includes("r7-compare-docs")) {
    return "disk-ref";
  }

  if (agentId && VFS_SNAPSHOT_AGENT_IDS.has(agentId)) {
    return "doc-compare";
  }

  const id = (agentId ?? "").toLowerCase();
  if (
    title.includes("сравнение 27") ||
    title.includes("compare-r7") ||
    id.includes("compare-r7")
  ) {
    return "doc-compare";
  }

  return "doc-compare";
}

/** disk-ref agents carry r7-disk:{id} in mentioned.files — not session VFS. */
export function isDiskRefFileId(fileId: string | null | undefined): boolean {
  return typeof fileId === "string" && fileId.startsWith("r7-disk:");
}

/** Returns merged plugin config from defaults and localStorage. */
export function getConfig(): PluginConfig {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_CONFIG };
    return { ...DEFAULT_CONFIG, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

/** Persists plugin config fields to localStorage. */
export function saveConfig(partial: Partial<PluginConfig>): PluginConfig {
  const next = { ...getConfig(), ...partial };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  return next;
}

export type EditorType = "word" | "cell";

/** Document identity from Asc.plugin.info. */
export function buildDocKey(info: AscPluginInfo): string {
  const title = info?.title ?? info?.documentTitle ?? "untitled";
  const url = info?.url ?? info?.key ?? info?.documentId ?? "";
  const editor = info?.editorType ?? "word";
  return `${editor}:${url || title}`;
}

declare global {
  interface AscPluginInfo {
    editorType?: EditorType;
    title?: string;
    documentTitle?: string;
    url?: string;
    key?: string;
    documentId?: string | number;
    documentCallbackUrl?: string;
    jwt?: string;
    externalData?: unknown;
    referenceData?: unknown;
    guid?: string;
  }

  const Api: {
    GetDocument: () => AscDocument;
    GetActiveSheet: () => AscSheet;
  };
}
