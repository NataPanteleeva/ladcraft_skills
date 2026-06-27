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
    };

export interface InsertBlock {
  kind: "insert";
  label: string;
  payload: ActionContentSource;
}

export interface DownloadBlock {
  kind: "download";
  label: string;
  payload: ActionContentSource;
  /** Suggested base name without extension. */
  baseName?: string;
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
}

export const INSERT_BLOCK_LABEL = "Вставить в документ";
export const DOWNLOAD_BLOCK_LABEL = "Скачать";
