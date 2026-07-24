/** Build-time plugin variant (overridden via esbuild --define). */
export type PluginVariant = "base" | "btn" | "btn_stream" | "side";

declare const __LC_PLUGIN_VARIANT__: string | undefined;

const VALID: PluginVariant[] = ["base", "btn", "btn_stream", "side"];

function readBuildVariant(): PluginVariant {
  const raw =
    typeof __LC_PLUGIN_VARIANT__ !== "undefined" ? __LC_PLUGIN_VARIANT__ : "btn_stream";
  if (VALID.includes(raw as PluginVariant)) return raw as PluginVariant;
  return "btn_stream";
}

export const BUILD_VARIANT: PluginVariant = readBuildVariant();
