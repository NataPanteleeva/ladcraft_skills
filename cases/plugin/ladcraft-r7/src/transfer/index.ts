/** @see plugins/ladcraft-r7/docs/01-transfer-rules.md */



import { buildDocKey, type EditorType } from "../config";

import type { EaiClient } from "../eai/client";

import {

  ensureDocumentContext,

  type EnsureContextResult,

  type EnsureContextOptions,

} from "./context-sync";

import {
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



export type { EnsureContextResult, EnsureContextOptions };

export { ensureDocumentContext } from "./context-sync";



/**

 * Block 1 entry point: sync document to VFS and build outbound message payload.

 */

export async function prepareOutbound(

  client: EaiClient,

  editorType: EditorType,

  userText: string,

  attachState: EditorAttachState,

  options: PrepareOutboundOptions = {},

): Promise<{ outbound: OutboundTransfer; context: EnsureContextResult }> {

  const docKey =

    options.docKey ??

    buildDocKey({ ...(window.Asc?.plugin?.info ?? {}), editorType });



  const context = await ensureDocumentContext(client, editorType, {

    forceReupload: options.forceReupload,

    docKey,

    sessionId: options.sessionId,

  });



  const selectionText = await getSelectedText();

  const content = appendSelectionContext(userText, selectionText);



  const profile = options.transferProfile ?? "doc-compare";

  const fileRefs: ReturnType<typeof documentFileRef>[] = [];
  if (shouldMentionDocumentFiles(attachState, profile)) {
    fileRefs.push(
      documentFileRef(
        context.fileId,
        documentBashPath(context.fileName),
      ),
    );
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


