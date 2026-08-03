/** @see plugins/ladcraft-r7/docs/01-transfer-rules.md */

import {
  buildDocKey,
  DEFAULT_TRANSFER_PROFILE,
  resolveContextFamily,
  type EditorType,
} from "../config";

import type { EaiClient } from "../eai/client";

import {
  ensureDocumentContext,
  type EnsureContextResult,
  type EnsureContextOptions,
} from "./context-sync";

import {
  appendSnapshotPathSupplement,
  appendWorkbookPathSupplement,
  documentBashPath,
  documentFileRef,
  shouldAttachEditor,
  shouldMentionDocumentFiles,
  userAsksToRefineLastResult,
  workbookBashPath,
  workbookFileRef,
} from "./message-payload";

import { extractLatestTargetPathFromToolCalls } from "../apply/agent-deliverables";

import {
  appendSelectionContext,
  getSelectedText,
  uploadSelectionContext,
} from "./selection";

import type { EditorAttachState, OutboundTransfer, PrepareOutboundOptions } from "./types";
import { prepareDiskRefOutbound } from "./disk-ref";
import { normalizeTemplateSelection, resolveTemplateSelection } from "./template-selection";
import { resolveInboundPayloadKind } from "./context-family";
import { ensureWorkbookContext } from "./workbook-context";

export {
  collectPresentedTemplateChoices,
  normalizeTemplateSelection,
  resolveTemplateSelection,
} from "./template-selection";

export type { EnsureContextResult, EnsureContextOptions };
export { ensureDocumentContext } from "./context-sync";
export { ensureWorkbookContext } from "./workbook-context";
export {
  resolveContextFamily,
  resolveInboundPayloadKind,
  type ContextFamily,
} from "./context-family";

/**
 * Block 1 entry point: outbound payload (VFS default; disk-ref opt-in).
 */
export async function prepareOutbound(
  client: EaiClient,
  editorType: EditorType,
  userText: string,
  attachState: EditorAttachState,
  options: PrepareOutboundOptions = {},
): Promise<{ outbound: OutboundTransfer; context: EnsureContextResult }> {
  const profile = options.transferProfile ?? DEFAULT_TRANSFER_PROFILE;
  if (profile === "disk-ref") {
    const outbound = await prepareDiskRefOutbound(editorType, userText, attachState, {
      ...options,
      historyMessages: options.historyMessages,
    });
    const stubContext: EnsureContextResult = {
      fileId: outbound.primaryFileId,
      fileName: outbound.primaryFileName,
      contentHash: "",
      skippedUpload: true,
    };
    return { outbound, context: stubContext };
  }

  const docKey =
    options.docKey ?? buildDocKey({ ...(window.Asc?.plugin?.info ?? {}), editorType });

  const family = resolveContextFamily(editorType, options.agentId);
  const payloadKind = resolveInboundPayloadKind(family, profile);

  const context =
    payloadKind === "workbook_binary"
      ? await ensureWorkbookContext(client, editorType, {
          forceReupload: options.forceReupload,
          docKey,
          sessionId: options.sessionId,
        })
      : await ensureDocumentContext(client, editorType, {
          forceReupload: options.forceReupload,
          docKey,
          sessionId: options.sessionId,
        });

  const selectionText = await getSelectedText();
  const history = options.historyMessages ?? [];
  // Template `*.md` normalize is for Word compare pickers only — never rewrite
  // Cell analytics choices («Сводная…») into `….md` (broke Ladcraft + UI).
  const outboundText =
    family === "spreadsheet" || history.length === 0
      ? userText
      : normalizeTemplateSelection(userText, history);

  const bashPath =
    payloadKind === "workbook_binary"
      ? workbookBashPath(context.fileName, options.sessionId)
      : documentBashPath(context.fileName, options.sessionId);

  const isTemplateTurn =
    family === "document" &&
    history.length > 0 &&
    resolveTemplateSelection(userText, history).matched;

  const withPathSupplement = isTemplateTurn
    ? appendSnapshotPathSupplement(outboundText, bashPath)
    : payloadKind === "workbook_binary"
      ? appendWorkbookPathSupplement(outboundText, bashPath, {
          // Attach last_result only when the user clearly asks to refine a prior
          // deliverable — otherwise agents latch onto *_kpi.xlsx instead of the open book.
          lastResultPath: userAsksToRefineLastResult(outboundText)
            ? extractLatestTargetPathFromToolCalls(history) || undefined
            : undefined,
        })
      : outboundText;

  const content = appendSelectionContext(withPathSupplement, selectionText);

  const fileRefs: ReturnType<typeof documentFileRef>[] = [];
  if (shouldMentionDocumentFiles(attachState, profile)) {
    if (payloadKind === "workbook_binary") {
      fileRefs.push(workbookFileRef(context.fileId, bashPath));
    } else {
      fileRefs.push(documentFileRef(context.fileId, bashPath));
    }
  }

  const selectionRef = await uploadSelectionContext(
    client,
    editorType,
    docKey,
    selectionText,
    { sessionId: options.sessionId },
  );

  if (selectionRef) {
    fileRefs.push(selectionRef);
  }

  const attachEditor = shouldAttachEditor(attachState, context.fileId, profile);

  const outbound: OutboundTransfer = {
    content,
    fileRefs,
    attachEditor,
    contextState: "synced",
    primaryFileId: context.fileId,
    primaryFileName: context.fileName,
  };

  return { outbound, context };
}
