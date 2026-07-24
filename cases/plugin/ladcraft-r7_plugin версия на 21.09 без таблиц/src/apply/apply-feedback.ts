import type { R7Task } from "./task-parse";
import type { EditorTaskApplyResult } from "./task-runner";

export interface R7ApplyEventV1 {
  schema: "r7.event/v1";
  kind: "apply_result";
  applied: number;
  failed: number;
  errors: string[];
  tasks: Array<{ type: string; data: unknown }>;
  messageIds?: string[];
}

const R7_EVENT_FENCE_RE = /```r7\.event\s*([\s\S]*?)```/gi;
const ORPHAN_R7_EVENT_FENCE_RE = /```r7\.event[\s\S]*/gi;

/** Build apply_result payload for silent plugin → agent feedback. */
export function buildApplyEventPayload(
  result: EditorTaskApplyResult,
  messageIds: string[] = [],
): R7ApplyEventV1 {
  return {
    schema: "r7.event/v1",
    kind: "apply_result",
    applied: result.applied,
    failed: result.failed,
    errors: result.errors.slice(),
    tasks: result.successfulTasks.map((task) => ({
      type: task.type,
      data: task.data,
    })),
    messageIds: messageIds.length ? messageIds : undefined,
  };
}

/** Wrap payload as fenced block for POST /message content. */
export function formatR7EventBlock(payload: R7ApplyEventV1): string {
  return "```r7.event\n" + JSON.stringify(payload, null, 2) + "\n```";
}

export function isR7EventContent(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  if (/```r7\.event/i.test(t)) return true;
  return /"schema"\s*:\s*"r7\.event\/v1"/.test(t);
}

/** Strip r7.event fences from user/assistant display text. */
export function stripR7EventMarkup(text: string): string {
  let out = text.replace(R7_EVENT_FENCE_RE, "").trim();
  out = out.replace(ORPHAN_R7_EVENT_FENCE_RE, "").trim();
  return out.replace(/\n{3,}/g, "\n\n");
}

export function feedbackNotifyKey(sessionId: string, tasks: R7Task[]): string {
  const fingerprints = tasks
    .map((task) => `${task.type}:${JSON.stringify(task.data)}`)
    .sort()
    .join("|");
  return `${sessionId}:notify:${fingerprints}`;
}
