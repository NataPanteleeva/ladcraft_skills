import type { EditorType } from "../config";
import type { EaiClient } from "../eai/client";
import type { DeliverableCard } from "./deliverable";

/** Unified content source for insert and download operations. */
export type ActionContentSource =
  | {
      kind: "text";
      text: string;
      fileName?: string;
      mimeType?: string;
    }
  | {
      kind: "card";
      card: DeliverableCard;
    }
  | {
      kind: "base64";
      base64: string;
      fileName: string;
      mimeType?: string;
    };

export interface InsertBlock {
  kind: "insert";
  label: string;
  payload: ActionContentSource;
}

export interface DownloadBlock {
  kind: "download";
  label: string;
  /** Markdown / HTML fallback source. */
  payload: ActionContentSource;
  /** VFS deliver_file or inline content_base64 (*.docx). */
  docxPayload?: ActionContentSource;
  /** Suggested base name without extension. */
  baseName?: string;
  /** Send «скачать docx» to chat when export is not ready yet. */
  requestDocx?: boolean;
}

export type ActionBlock = InsertBlock | DownloadBlock;

/** Resolved UI actions for one assistant message. */
export interface MessageActionPlan {
  blocks: ActionBlock[];
}

export type InsertPosition = "start" | "end" | "cursor";

export interface ActionHandlers {
  client: EaiClient;
  editorType: EditorType;
  onStatus?: (message: string) => void;
  /** Trigger agent EXPORT phase (e.g. «скачать docx»). */
  onSendMessage?: (text: string) => Promise<void>;
}

export const INSERT_BLOCK_LABEL = "Вставить в документ";
export const DOWNLOAD_BLOCK_LABEL = "Скачать";
