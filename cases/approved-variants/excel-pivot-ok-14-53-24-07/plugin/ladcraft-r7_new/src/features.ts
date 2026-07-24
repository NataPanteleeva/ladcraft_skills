/** Runtime feature flags — unify former plugin forks (r7, btn, btn_stream, side). */

import { BUILD_VARIANT, type PluginVariant } from "./variant";

export type PanelLayout = "default" | "side";

export interface PluginFeatures {
  /** Live SSE token streaming during assistant turns. */
  sseStreaming: boolean;
  /** Shell/chat panel scroll layout (`side` = inside-mode scroll). */
  panelLayout: PanelLayout;
  /** Source variant label (informational). */
  variant: PluginVariant;
}

const VARIANT_PRESETS: Record<PluginVariant, Omit<PluginFeatures, "variant">> = {
  base: {
    sseStreaming: false,
    panelLayout: "default",
  },
  btn: {
    sseStreaming: false,
    panelLayout: "default",
  },
  btn_stream: {
    sseStreaming: true,
    panelLayout: "default",
  },
  side: {
    sseStreaming: false,
    panelLayout: "side",
  },
};

const FEATURES_STORAGE_KEY = "ladcraft_r7_features";

/** Legacy SSE toggle — merged into features.sseStreaming. */
const LEGACY_SSE_KEY = "ladcraft_r7_sse_enabled";

function readLocalOverride(): Partial<PluginFeatures> | null {
  try {
    const raw = localStorage.getItem(FEATURES_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const out: Partial<PluginFeatures> = {};
    if (typeof parsed.sseStreaming === "boolean") out.sseStreaming = parsed.sseStreaming;
    if (parsed.panelLayout === "default" || parsed.panelLayout === "side") {
      out.panelLayout = parsed.panelLayout;
    }
    return Object.keys(out).length ? out : null;
  } catch {
    return null;
  }
}

function readLegacySseOverride(): boolean | null {
  try {
    const raw = localStorage.getItem(LEGACY_SSE_KEY);
    if (raw === "0") return false;
    if (raw === "1") return true;
  } catch {
    /* ignore */
  }
  return null;
}

/** Resolved plugin features: build variant preset + localStorage overrides. */
export function getPluginFeatures(): PluginFeatures {
  const preset = VARIANT_PRESETS[BUILD_VARIANT];
  const override = readLocalOverride();
  const legacySse = readLegacySseOverride();

  return {
    variant: BUILD_VARIANT,
    sseStreaming: legacySse ?? override?.sseStreaming ?? preset.sseStreaming,
    panelLayout: override?.panelLayout ?? preset.panelLayout,
  };
}

/** Persist partial feature overrides (merged with build preset on next read). */
export function savePluginFeatures(partial: Partial<PluginFeatures>): PluginFeatures {
  const current = getPluginFeatures();
  const next: PluginFeatures = {
    ...current,
    ...partial,
    variant: BUILD_VARIANT,
  };
  localStorage.setItem(
    FEATURES_STORAGE_KEY,
    JSON.stringify({
      sseStreaming: next.sseStreaming,
      panelLayout: next.panelLayout,
    }),
  );
  if (partial.sseStreaming !== undefined) {
    localStorage.setItem(LEGACY_SSE_KEY, partial.sseStreaming ? "1" : "0");
  }
  return next;
}

/** Apply layout class on document root (call once at plugin start). */
export function applyPanelLayoutClass(features: PluginFeatures = getPluginFeatures()): void {
  if (typeof document === "undefined") return;
  document.body.classList.remove("layout-default", "layout-side");
  document.body.classList.add(`layout-${features.panelLayout}`);
}
