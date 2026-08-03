/** Thread projection (GET /v2/agent/thread/{id}/projection) — post-turn canon for AG-UI. */

import type { EaiClient } from "./client";
import { sanitizeAssistantChatText } from "../apply/display-sanitize";
import { stripUserMessageSupplements } from "../utils/message-text";
import type { ChatMessage } from "../ui/chat";
import type { AgentDeliverable } from "../apply/agent-deliverables";

export interface ProjectionFileRef {
  file_id: string;
  path?: string;
  display_name?: string;
  mime_type?: string;
  file_type?: string;
  relation?: string;
  scope?: string;
}

export interface ProjectionOrderedBlock {
  id?: string;
  kind?: string;
  type?: string;
  content?: string;
  status?: string;
  [key: string]: unknown;
}

export interface ProjectionMessage {
  id: string;
  role: string;
  status?: string;
  orderedBlocks?: ProjectionOrderedBlock[];
  responseFileReferences?: {
    files?: ProjectionFileRef[];
    schema_version?: string;
  } | null;
}

export interface ProjectionTerminal {
  status?: string;
  outcome?: { type?: string; interrupts?: unknown[] };
  result?: { responseText?: string; completionReason?: string };
}

export interface RunProjection {
  messages?: ProjectionMessage[];
  tools?: unknown[];
  terminal?: ProjectionTerminal | null;
  lastAppliedSeq?: number;
  threadId?: string;
  runId?: string;
  [key: string]: unknown;
}

export interface ProjectionRun {
  run_id?: string;
  runId?: string;
  last_applied_seq?: number;
  projection?: RunProjection;
}

export interface ThreadProjection {
  schema_version?: string;
  projection_version?: string;
  last_thread_seq?: number;
  runs?: ProjectionRun[];
  result?: { runs?: ProjectionRun[] };
}

export function unwrapProjectionRuns(proj: ThreadProjection | null | undefined): ProjectionRun[] {
  if (!proj) return [];
  if (Array.isArray(proj.runs) && proj.runs.length) return proj.runs;
  if (Array.isArray(proj.result?.runs)) return proj.result!.runs!;
  return [];
}

export function maxAppliedSeq(proj: ThreadProjection | null | undefined): number {
  let max = 0;
  for (const run of unwrapProjectionRuns(proj)) {
    const seq = Number(run.last_applied_seq || run.projection?.lastAppliedSeq || 0);
    if (Number.isFinite(seq) && seq > max) max = seq;
  }
  const threadSeq = Number(proj?.last_thread_seq || 0);
  if (Number.isFinite(threadSeq) && threadSeq > max) max = threadSeq;
  return max;
}

/** Fetch current thread projection. */
export async function getThreadProjection(
  client: EaiClient,
  threadId: string,
): Promise<ThreadProjection> {
  return client.request<ThreadProjection>(
    `/v2/agent/thread/${encodeURIComponent(threadId)}/projection`,
  );
}

/** Poll until last_applied_seq >= minSeq (or attempts exhausted). */
export async function waitThreadProjection(
  client: EaiClient,
  threadId: string,
  options: { minSeq?: number; attempts?: number; delayMs?: number } = {},
): Promise<{ projection: ThreadProjection; attempt: number; maxSeq: number; stale: boolean }> {
  const minSeq = options.minSeq ?? 0;
  const attempts = options.attempts ?? 8;
  const delayMs = options.delayMs ?? 800;
  let last: ThreadProjection | null = null;
  for (let i = 0; i < attempts; i++) {
    last = await getThreadProjection(client, threadId);
    const seq = maxAppliedSeq(last);
    if (!minSeq || seq >= minSeq) {
      return { projection: last, attempt: i + 1, maxSeq: seq, stale: false };
    }
    await new Promise((r) => setTimeout(r, delayMs));
  }
  return {
    projection: last || { runs: [] },
    attempt: attempts,
    maxSeq: maxAppliedSeq(last),
    stale: true,
  };
}

export function textFromOrderedBlocks(blocks: ProjectionOrderedBlock[] | undefined): string {
  if (!Array.isArray(blocks) || !blocks.length) return "";
  const parts: string[] = [];
  for (const b of blocks) {
    const kind = String(b.kind || b.type || "");
    if (kind !== "text") continue;
    const content = typeof b.content === "string" ? b.content : "";
    if (content) parts.push(content);
  }
  return parts.join("\n\n").trim();
}

export function fileRefsFromMessage(message: ProjectionMessage): ProjectionFileRef[] {
  const files = message.responseFileReferences?.files;
  if (!Array.isArray(files)) return [];
  return files.filter((f) => f && typeof f.file_id === "string" && f.file_id.trim());
}

export function deliverableFromFileRef(ref: ProjectionFileRef): AgentDeliverable | null {
  const fileId = String(ref.file_id || "").trim();
  if (!fileId) return null;
  const pathRaw = String(ref.path || "").trim();
  let vfsPath = pathRaw.replace(/^~/, "") || "";
  if (vfsPath && !vfsPath.startsWith("/")) vfsPath = `/${vfsPath}`;
  const fileName =
    String(ref.display_name || "").trim() ||
    (vfsPath ? vfsPath.split("/").pop() || "" : "") ||
    `${fileId}.xlsx`;
  if (!vfsPath) vfsPath = `/session/${fileName}`;
  const mime =
    String(ref.mime_type || "").trim() ||
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  // Only spreadsheet deliverables drive Cell action bar.
  const isXlsx =
    /\.xlsx$/i.test(fileName) ||
    /\.xlsx$/i.test(vfsPath) ||
    /spreadsheet/i.test(String(ref.file_type || "")) ||
    /spreadsheetml/i.test(mime);
  if (!isXlsx) return null;
  return { vfsPath, fileName, mime, fileId };
}

export function collectProjectionDeliverables(proj: ThreadProjection): AgentDeliverable[] {
  const out: AgentDeliverable[] = [];
  const seen = new Set<string>();
  for (const run of unwrapProjectionRuns(proj)) {
    const messages = run.projection?.messages || [];
    for (const m of messages) {
      for (const ref of fileRefsFromMessage(m)) {
        const d = deliverableFromFileRef(ref);
        if (!d) continue;
        const key = d.fileId || d.vfsPath;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(d);
      }
    }
  }
  return out;
}

/** Flatten projection messages into ChatMessage[] (user/assistant text blocks). */
export function projectionToChatMessages(proj: ThreadProjection): ChatMessage[] {
  const out: ChatMessage[] = [];
  for (const run of unwrapProjectionRuns(proj)) {
    const messages = run.projection?.messages || [];
    for (const m of messages) {
      const role = String(m.role || "");
      if (role !== "user" && role !== "assistant") continue;
      const rawText = textFromOrderedBlocks(m.orderedBlocks);
      const fileRefs = fileRefsFromMessage(m);
      if (!rawText.trim() && !fileRefs.length && role === "assistant") {
        // Skip empty tool-only shells without text/files.
        const kinds = (m.orderedBlocks || []).map((b) => b.kind || b.type);
        if (!kinds.includes("text")) continue;
      }
      if (role === "user") {
        // Keep R7 context on the wire; hide it in the chat bubble.
        out.push({
          id: m.id,
          role: "user",
          text: stripUserMessageSupplements(rawText || "") || "(пусто)",
        });
        continue;
      }
      const applyText = rawText || undefined;
      const display = sanitizeAssistantChatText(rawText || "");
      out.push({
        id: m.id,
        role: "assistant",
        text: display || rawText || "",
        applyText,
        fileReferences: fileRefs.length ? fileRefs : undefined,
      });
    }
  }
  return out;
}

export function projectionTerminalStatus(proj: ThreadProjection): {
  finished: boolean;
  interrupt: boolean;
  waitingUser: boolean;
  responseText: string;
} {
  const runs = unwrapProjectionRuns(proj);
  const last = runs[runs.length - 1];
  const terminal = last?.projection?.terminal;
  const status = String(terminal?.status || "").toLowerCase();
  const outcomeType = String(terminal?.outcome?.type || "").toLowerCase();
  const interrupt = outcomeType === "interrupt";
  const finished = status === "finished" || status === "completed" || interrupt;
  const waitingUser =
    interrupt &&
    /waiting_user/i.test(JSON.stringify(terminal?.outcome || {}));
  const responseText = String(terminal?.result?.responseText || "").trim();
  return { finished, interrupt, waitingUser, responseText };
}

/** Ready for plugin wait to end: terminal done, or file refs, or substantive assistant text. */
export function isProjectionTurnReady(proj: ThreadProjection): boolean {
  const term = projectionTerminalStatus(proj);
  if (term.finished) return true;
  if (collectProjectionDeliverables(proj).length) return true;
  const messages = projectionToChatMessages(proj);
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.role !== "assistant") continue;
    const raw = (m.applyText || m.text || "").trim();
    if (raw.length >= 40) return true;
    if (m.fileReferences?.length) return true;
    break;
  }
  return false;
}

export interface ProjectionWaitResult {
  projection: ThreadProjection;
  waitingForUser: boolean;
  replyText: string;
  deliverables: AgentDeliverable[];
}

/**
 * Poll projection until turn looks ready (or timeout).
 * Replaces v1 history wait for AG-UI sessions.
 */
export async function waitForProjectionTurn(
  client: EaiClient,
  threadId: string,
  options: {
    timeoutMs?: number;
    pollMs?: number;
    minSeq?: number;
    onProgress?: (label: string) => void;
    onPoll?: () => void | Promise<void>;
    /** Stream already painted a usable answer — stop waiting on slow projection. */
    isLocallyReady?: () => boolean;
  } = {},
): Promise<ProjectionWaitResult | null> {
  const timeoutMs = options.timeoutMs ?? 180_000;
  const pollMs = options.pollMs ?? 1200;
  const started = Date.now();
  let last: ThreadProjection | null = null;

  while (Date.now() - started < timeoutMs) {
    if (options.isLocallyReady?.()) {
      options.onProgress?.("Ответ готов");
      try {
        last = last || (await getThreadProjection(client, threadId));
      } catch {
        /* local stream is enough */
      }
      return {
        projection: last || { runs: [] },
        waitingForUser: last ? projectionTerminalStatus(last).waitingUser : false,
        replyText: last ? projectionTerminalStatus(last).responseText : "",
        deliverables: last ? collectProjectionDeliverables(last) : [],
      };
    }

    try {
      if (options.minSeq && options.minSeq > 0) {
        const waited = await waitThreadProjection(client, threadId, {
          minSeq: options.minSeq,
          attempts: 3,
          delayMs: Math.min(pollMs, 800),
        });
        last = waited.projection;
      } else {
        last = await getThreadProjection(client, threadId);
      }
    } catch (err) {
      console.warn("[ladcraft-r7_agui] projection poll", err);
      await new Promise((r) => setTimeout(r, pollMs));
      continue;
    }

    if (options.onPoll) {
      try {
        await options.onPoll();
      } catch (err) {
        console.warn("[ladcraft-r7_agui] projection onPoll", err);
      }
    }

    if (last && isProjectionTurnReady(last)) {
      const term = projectionTerminalStatus(last);
      options.onProgress?.(
        term.waitingUser ? "Ожидание ответа пользователя…" : "Ответ готов",
      );
      return {
        projection: last,
        waitingForUser: term.waitingUser,
        replyText: term.responseText,
        deliverables: collectProjectionDeliverables(last),
      };
    }

    options.onProgress?.("Агент выполняет запрос…");
    await new Promise((r) => setTimeout(r, pollMs));
  }

  return last
    ? {
        projection: last,
        waitingForUser: projectionTerminalStatus(last).waitingUser,
        replyText: projectionTerminalStatus(last).responseText,
        deliverables: collectProjectionDeliverables(last),
      }
    : null;
}
