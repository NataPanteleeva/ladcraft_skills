/** Plugin runtime configuration (override via localStorage). */

export interface PluginConfig {
  baseUrl: string;
  selectedAgentId: string;
}

const STORAGE_KEY = "ladcraft_r7_plugin_config";

const DEFAULT_CONFIG: PluginConfig = {
  baseUrl: "https://api.ladcraft.ru",
  selectedAgentId: "",
};

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
    documentId?: string;
    guid?: string;
  }

  const Api: {
    GetDocument: () => AscDocument;
    GetActiveSheet: () => AscSheet;
  };
}
