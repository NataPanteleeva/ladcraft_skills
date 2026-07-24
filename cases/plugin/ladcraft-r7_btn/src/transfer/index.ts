/** @see plugins/ladcraft-r7/docs/01-transfer-rules.md */



import { buildDocKey, type EditorType } from "../config";

import type { EaiClient } from "../eai/client";

import {

  ensureDocumentContext,

  type EnsureContextResult,

  type EnsureContextOptions,

} from "./context-sync";

import {
  appendSnapshotPathSupplement,
  documentBashPath,
  documentFileRef,
  shouldAttachEditor,
  shouldMentionDocumentFiles,
} from "./message-payload";

import {

  appendSelectionContext,

  getSelectedText,

  uploadSelectionContext,

} from "./selection";

import type { EditorAttachState, OutboundTransfer, PrepareOutboundOptions } from "./types";
import { prepareDiskRefOutbound } from "./disk-ref";
import { normalizeTemplateSelection, resolveTemplateSelection } from "./template-selection";

export {
  collectPresentedTemplateChoices,
  normalizeTemplateSelection,
  resolveTemplateSelection,
} from "./template-selection";



export type { EnsureContextResult, EnsureContextOptions };

export { ensureDocumentContext } from "./context-sync";



/**

 * Block 1 entry point: build outbound message payload (disk-ref default; VFS opt-in).

 */

export async function prepareOutbound(

  client: EaiClient,

  editorType: EditorType,

  userText: string,

  attachState: EditorAttachState,

  options: PrepareOutboundOptions = {},

): Promise<{ outbound: OutboundTransfer; context: EnsureContextResult }> {

  const profile = options.transferProfile ?? "doc-compare";

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

    options.docKey ??

    buildDocKey({ ...(window.Asc?.plugin?.info ?? {}), editorType });



  const context = await ensureDocumentContext(client, editorType, {

    forceReupload: options.forceReupload,

    docKey,

    sessionId: options.sessionId,

  });



  const selectionText = await getSelectedText();

  const history = options.historyMessages ?? [];
  const outboundText = history.length
    ? normalizeTemplateSelection(userText, history)
    : userText;

  const bashPath = documentBashPath(context.fileName);
  const isCompareTurn =
    history.length > 0 &&
    resolveTemplateSelection(userText, history).matched;
  const withSnapshotPath = isCompareTurn
    ? appendSnapshotPathSupplement(outboundText, bashPath)
    : outboundText;
  const content = appendSelectionContext(withSnapshotPath, selectionText);

  const fileRefs: ReturnType<typeof documentFileRef>[] = [];
  if (shouldMentionDocumentFiles(attachState, profile)) {
    fileRefs.push(documentFileRef(context.fileId, bashPath));
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


