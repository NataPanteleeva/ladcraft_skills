/** AG-UI run helpers: POST /v2/agent/run + SSE event parse. */

import type { EaiClient } from "./client";
import type { ChatTransportCallbacks } from "./transport";
import { preferRicherOrAppend } from "./assistant-text-merge";

export interface AgUiFileRef {
  file_id: string;
  file_name?: string;
  mime_type?: string;
}

export interface AgUiRunOptions {
  threadId: string;
  content: string;
  fileRefs?: AgUiFileRef[];
  attachEditorFile?: boolean;
  signal?: AbortSignal;
  /** Resume after disconnect */
  afterSeq?: number;
  lastEventId?: string;
  reconnect?: boolean;
  runId?: string;
}

export interface AgUiRunResult {
  runId: string;
  lastEventId: string;
  lastSeq: number;
  outcome: "success" | "error" | "interrupt" | "closed";
  errorMessage?: string;
  responseText: string;
}

type AgUiEvent = {
  type: string;
  name?: string;
  messageId?: string;
  delta?: string;
  role?: string;
  code?: string;
  message?: string;
  value?: Record<string, unknown>;
  result?: { responseText?: string };
  outcome?: { type?: string };
  [key: string]: unknown;
};

/** Ladcraft AG-UI rejects UUID-with-hyphens; use session-like nanoid (21 chars). */
function newId(len = 21): string {
  const alphabet =
    "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz_";
  let out = "";
  if (typeof crypto !== "undefined" && crypto.getRandomValues) {
    const bytes = new Uint8Array(len);
    crypto.getRandomValues(bytes);
    for (let i = 0; i < len; i++) out += alphabet[bytes[i] % alphabet.length];
    return out;
  }
  for (let i = 0; i < len; i++) {
    out += alphabet[(Math.random() * alphabet.length) | 0];
  }
  return out;
}

function isDiskRef(fileId: string): boolean {
  return fileId.startsWith("r7-disk:") || fileId.startsWith("r7-disk-by-name:");
}

/** Build AG-UI RunAgentInput body. */
export function buildAgUiRunInput(options: AgUiRunOptions): Record<string, unknown> {
  const runId = options.runId || newId();
  const messageId = newId();
  const refs = options.fileRefs ?? [];
  const vfsRefs = refs.filter((r) => r.file_id && !isDiskRef(r.file_id));
  const diskRefs = refs.filter((r) => r.file_id && isDiskRef(r.file_id));

  const contentParts: Array<Record<string, unknown>> = [
    { type: "text", text: options.content },
  ];

  for (const ref of vfsRefs) {
    const mime =
      ref.mime_type ||
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    contentParts.push({
      type: "document",
      source: {
        type: "url",
        value: `/v1/agent/vfs/files/${ref.file_id}/download`,
        mimeType: mime,
      },
      metadata: {
        file_id: ref.file_id,
        file_name: ref.file_name || "",
        mime_type: mime,
        source: "attached",
        scope: "session",
      },
    });
  }

  const forwardedProps: Record<string, unknown> = {
    locale: "ru",
    timezone: "Europe/Moscow",
  };
  if (options.reconnect) forwardedProps.reconnect = true;
  if (diskRefs.length) {
    forwardedProps.r7DiskRefs = diskRefs.map((r) => ({
      file_id: r.file_id,
      file_name: r.file_name,
      mime_type: r.mime_type,
    }));
  }
  if (options.attachEditorFile && vfsRefs[0]) {
    forwardedProps.filesEditor = [vfsRefs[0]];
  }

  // Keep Ladcraft mentioned.files shape for skills that still expect it (hybrid).
  if (refs.length) {
    forwardedProps.mentioned = {
      files: refs.map((r) => ({
        file_id: r.file_id,
        file_name: r.file_name ?? null,
        mime_type: r.mime_type ?? null,
      })),
    };
  }

  return {
    threadId: options.threadId,
    runId,
    messages: options.reconnect
      ? []
      : [
          {
            id: messageId,
            role: "user",
            content: contentParts.length === 1 ? options.content : contentParts,
          },
        ],
    tools: [],
    context: [],
    forwardedProps,
  };
}

/**
 * POST /v2/agent/run and drive ChatTransportCallbacks from AG-UI SSE events.
 * Handles TEXT_MESSAGE_* plus CUSTOM draft/text.replaced.
 */
export async function runAgUiAgent(
  client: EaiClient,
  options: AgUiRunOptions,
  callbacks: ChatTransportCallbacks,
): Promise<AgUiRunResult> {
  const input = buildAgUiRunInput(options);
  const runId = String(input.runId);
  let urlPath = "/v2/agent/run";
  if (options.afterSeq && options.afterSeq > 0) {
    urlPath += `?afterSeq=${options.afterSeq}`;
  }

  const headers: Record<string, string> = {
    Accept: "text/event-stream",
  };
  if (options.lastEventId) {
    headers["Last-Event-ID"] = options.lastEventId;
  }

  const response = await client.streamRequest(urlPath, {
    method: "POST",
    body: input,
    headers,
    signal: options.signal,
  });

  if (!response.ok) {
    const errText = await response.text().catch(() => "");
    throw new Error(`AG-UI HTTP ${response.status}: ${errText || response.statusText}`);
  }
  if (!response.body) {
    throw new Error("AG-UI: сервер не вернул поток");
  }

  const messages = new Map<string, string>();
  const drafts = new Map<string, { draftId: string; textBeforeDraft: string }>();
  let lastEventId = options.lastEventId ?? "";
  let lastSeq = options.afterSeq ?? 0;
  let outcome: AgUiRunResult["outcome"] = "closed";
  let errorMessage: string | undefined;
  let responseText = "";
  let activeMessageId: string | null = null;

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  const applyCustom = (event: AgUiEvent): void => {
    const value = (event.value ?? {}) as Record<string, unknown>;
    const messageId = String(value.messageId ?? "");
    if (!messageId) return;

    if (event.name === "eai.message.draft.started") {
      drafts.set(messageId, {
        draftId: String(value.draftId ?? ""),
        textBeforeDraft: messages.get(messageId) ?? "",
      });
      return;
    }
    if (event.name === "eai.message.draft.committed") {
      const draft = drafts.get(messageId);
      if (draft && draft.draftId === String(value.draftId ?? "")) {
        drafts.delete(messageId);
      }
      return;
    }
    if (event.name === "eai.message.draft.rejected") {
      const draft = drafts.get(messageId);
      if (draft && draft.draftId === String(value.draftId ?? "")) {
        messages.set(messageId, draft.textBeforeDraft);
        drafts.delete(messageId);
        callbacks.onDelta?.(messageId, "", draft.textBeforeDraft);
      }
      return;
    }
    if (event.name === "eai.message.text.replaced") {
      // Server often sends a short plain "replacement" after a richer stream.
      // Do not wipe the painted bubble — only append missing bits.
      const content = String(value.content ?? "");
      const prev = messages.get(messageId) ?? "";
      const next = preferRicherOrAppend(prev, content);
      messages.set(messageId, next);
      callbacks.onDelta?.(messageId, "", next);
      return;
    }
    if (event.name === "eai.message.file_references") {
      const filesRaw = Array.isArray(value.files) ? value.files : [];
      const files = filesRaw
        .map((f) => {
          if (!f || typeof f !== "object") return null;
          const row = f as Record<string, unknown>;
          const fileId = String(row.file_id || "").trim();
          if (!fileId) return null;
          return {
            file_id: fileId,
            path: typeof row.path === "string" ? row.path : undefined,
            display_name:
              typeof row.display_name === "string" ? row.display_name : undefined,
            mime_type: typeof row.mime_type === "string" ? row.mime_type : undefined,
            file_type: typeof row.file_type === "string" ? row.file_type : undefined,
          };
        })
        .filter(Boolean) as Array<{
        file_id: string;
        path?: string;
        display_name?: string;
        mime_type?: string;
        file_type?: string;
      }>;
      if (files.length) {
        callbacks.onFileReferences?.(messageId, files);
      }
    }
  };

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      while (true) {
        const separator = buffer.match(/\r?\n\r?\n/);
        if (!separator || separator.index === undefined) break;
        const block = buffer.slice(0, separator.index);
        buffer = buffer.slice(separator.index + separator[0].length);

        let eventId = "";
        const dataLines: string[] = [];
        for (const line of block.replace(/\r\n/g, "\n").split("\n")) {
          if (line.startsWith("id:")) eventId = line.slice(3).trim();
          if (line.startsWith("data:")) dataLines.push(line.slice(5).replace(/^ /, ""));
        }
        if (!dataLines.length) continue;

        let event: AgUiEvent;
        try {
          event = JSON.parse(dataLines.join("\n")) as AgUiEvent;
        } catch {
          continue;
        }

        if (eventId) {
          lastEventId = eventId;
          const parts = eventId.split(":");
          const seq = Number(parts[parts.length - 1]);
          if (Number.isFinite(seq)) lastSeq = seq;
        }

        if (event.type === "TEXT_MESSAGE_START") {
          const messageId = String(event.messageId ?? "");
          if (!messageId) continue;
          activeMessageId = messageId;
          if (!messages.has(messageId)) messages.set(messageId, "");
          callbacks.onMessageStart?.(messageId);
          continue;
        }

        if (event.type === "TEXT_MESSAGE_CONTENT") {
          const messageId = String(event.messageId ?? activeMessageId ?? "");
          if (!messageId) continue;
          activeMessageId = messageId;
          const delta = String(event.delta ?? "");
          const next = (messages.get(messageId) ?? "") + delta;
          messages.set(messageId, next);
          callbacks.onDelta?.(messageId, delta, next);
          continue;
        }

        if (event.type === "TEXT_MESSAGE_END") {
          const messageId = String(event.messageId ?? activeMessageId ?? "");
          if (!messageId) continue;
          callbacks.onMessageDone?.(messageId, "completed");
          continue;
        }

        if (event.type === "CUSTOM") {
          applyCustom(event);
          continue;
        }

        if (event.type === "RUN_FINISHED") {
          if (event.result?.responseText) {
            responseText = String(event.result.responseText);
          } else if (activeMessageId) {
            responseText = messages.get(activeMessageId) ?? "";
          }
          const otype = event.outcome?.type;
          outcome = otype === "interrupt" ? "interrupt" : "success";
          if (activeMessageId && !responseText) {
            responseText = messages.get(activeMessageId) ?? "";
          }
          // Ensure message_done if TEXT_MESSAGE_END was skipped.
          if (activeMessageId) {
            callbacks.onMessageDone?.(activeMessageId, outcome);
          }
          continue;
        }

        if (event.type === "RUN_ERROR") {
          outcome = "error";
          errorMessage = String(event.message || event.code || "RUN_ERROR");
          callbacks.onError?.(new Error(errorMessage));
          if (activeMessageId) {
            callbacks.onMessageDone?.(activeMessageId, "error");
          }
        }
      }
    }
  } catch (err) {
    if (options.signal?.aborted) {
      outcome = "error";
      errorMessage = "aborted";
    } else {
      callbacks.onError?.(err);
      throw err;
    }
  }

  if (outcome === "closed") {
    // Connection ended without RUN_*; caller may reconnect.
    outcome = "closed";
  }

  if (!responseText && activeMessageId) {
    responseText = messages.get(activeMessageId) ?? "";
  }

  return {
    runId,
    lastEventId,
    lastSeq,
    outcome,
    errorMessage,
    responseText,
  };
}

/** Explicit server-side cancel for an AG-UI run. */
export async function cancelAgUiRun(
  client: EaiClient,
  runId: string,
  threadId: string,
): Promise<void> {
  await client.request(`/v2/agent/run/${encodeURIComponent(runId)}/cancel`, {
    method: "POST",
    body: { threadId },
  });
}
