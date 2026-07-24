import type { HistoryMessage } from "../eai/session";
import type { ActionContentSource } from "./types";

const DOCX_EXPORT_TOOL_NAMES = new Set([
  "r7_render_and_deliver_docx",
  "r7_render_docx",
  "r7_deliver_docx",
  "r7-export",
]);

const DEFAULT_DOCX_MIME =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

/** Inline DOCX payload from tool_calls result (scenario B — content_base64). */
export interface DocxInlinePayload {
  base64: string;
  fileName: string;
  mimeType: string;
}

/** Map inline payload to ActionContentSource for download handlers. */
export function docxInlineToActionSource(payload: DocxInlinePayload): ActionContentSource {
  return {
    kind: "base64",
    base64: payload.base64,
    fileName: payload.fileName,
    mimeType: payload.mimeType,
  };
}

/**
 * Extract DOCX base64 from export tool_calls on an assistant message.
 * Iterates tool_calls from the end; never throws on malformed JSON.
 */
export function extractDocxFromToolCalls(message: HistoryMessage): DocxInlinePayload | null {
  try {
    const calls = message.tool_calls;
    if (!calls?.length) return null;

    for (let i = calls.length - 1; i >= 0; i--) {
      const payload = parseDocxToolPayload(calls[i]);
      if (payload) return payload;
    }
  } catch {
    return null;
  }
  return null;
}

function parseDocxToolPayload(call: NonNullable<HistoryMessage["tool_calls"]>[number]): DocxInlinePayload | null {
  const name = (call.name ?? call.tool_name ?? "").trim();
  if (name && !isDocxExportToolName(name)) return null;

  for (const field of [call.result, call.arguments, call.args]) {
    const payload = extractFromParsed(parseToolField(field));
    if (payload) return payload;
  }
  return null;
}

function isDocxExportToolName(name: string): boolean {
  const normalized = name.toLowerCase();
  return DOCX_EXPORT_TOOL_NAMES.has(normalized);
}

function parseToolField(raw: unknown): unknown {
  if (raw == null) return null;
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }
  if (typeof raw === "object") return raw;
  return null;
}

function extractFromParsed(parsed: unknown): DocxInlinePayload | null {
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;

  const obj = parsed as Record<string, unknown>;
  if (obj.ok === false) return null;

  const fileId = pickString(obj.fileId, obj.file_id);
  const delivery = pickString(obj.delivery)?.toLowerCase();
  if (delivery === "deliver_file" && fileId) return null;

  const base64 = pickString(obj.content_base64, obj.contentBase64)?.replace(/\s/g, "") ?? "";
  if (base64.length < 16) return null;

  const fileName = pickString(obj.fileName, obj.file_name) ?? "";
  if (!/\.docx?$/i.test(fileName)) return null;

  const mimeType =
    pickString(obj.mimeType, obj.mime_type) ?? DEFAULT_DOCX_MIME;

  return { base64, fileName, mimeType };
}

function pickString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return undefined;
}

/** Index of a later assistant message with inline DOCX export, if any. */
export function findLaterDocxExportIndex(
  items: HistoryMessage[],
  fromIndex: number,
): number | null {
  for (let j = fromIndex + 1; j < items.length; j++) {
    const item = items[j];
    if (item.role === "assistant" && extractDocxFromToolCalls(item)) {
      return j;
    }
  }
  return null;
}
