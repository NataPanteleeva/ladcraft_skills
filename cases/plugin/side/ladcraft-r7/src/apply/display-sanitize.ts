import { stripTaskMarkup } from "./task-parse";

const LEAKED_TASK_ARRAY_RE =
  /\[\s*\{[\s\S]*?"type"\s*:\s*"(?:deliver_inline|deliver_file|paste|paste_text|share_link)"[\s\S]*?\}\s*\]/gi;

const LEAKED_TOOL_JSON_RE =
  /\{[\s\S]*?"(?:content_base64|contentBase64|delivery|inline_base64|fileId|file_id)"[\s\S]*?\}/gi;

/** Fenced ```json block with doc-compare skill payload — not for chat display. */
const DOC_COMPARE_JSON_FENCE_RE =
  /```(?:json)?\s*\{[\s\S]*?"schema"\s*:\s*"doc-compare\/v1"[\s\S]*?\}\s*```/gi;

/** Unfenced doc-compare JSON pasted after markdown report. */
const DOC_COMPARE_JSON_BLOB_RE =
  /\{[\s\S]*?"schema"\s*:\s*"doc-compare\/v1"[\s\S]*?\}(?=\s*(?:\n---|\n\*r7\.task|\n```|$))/gi;

const LONG_BASE64_LINE_RE = /^[^\n]*[A-Za-z0-9+/=]{120,}[^\n]*$/gm;

const ORPHAN_R7_FENCE_RE = /```r7\.task[\s\S]*/gi;

const TRAILING_FENCE_RE = /```\s*$/;

const ORPHAN_R7_TASK_LABEL_RE = /^\*r7\.task\*:\s*$/gm;

/** Remove r7.task blocks, tool JSON, compare JSON, and base64 blobs from assistant chat display. */
export function sanitizeAssistantChatText(text: string): string {
  let out = stripTaskMarkup(text);
  out = out.replace(DOC_COMPARE_JSON_FENCE_RE, "");
  out = out.replace(DOC_COMPARE_JSON_BLOB_RE, "");
  out = out.replace(LEAKED_TASK_ARRAY_RE, "");
  out = out.replace(LEAKED_TOOL_JSON_RE, "");
  out = out.replace(LONG_BASE64_LINE_RE, "");
  out = out.replace(ORPHAN_R7_FENCE_RE, "");
  out = out.replace(TRAILING_FENCE_RE, "");
  out = out.replace(ORPHAN_R7_TASK_LABEL_RE, "");
  out = out.replace(/```\s*```/g, "");
  out = out.replace(/\n{3,}/g, "\n\n").trim();
  return out;
}
