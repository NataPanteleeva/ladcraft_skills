import type { EaiClient } from "../eai/client";
import { downloadVfsText } from "../eai/vfs";
import type { DeliverableCard } from "./deliverable";
import { insertText } from "./editor-methods";
import type { ActionContentSource, InsertPosition } from "./types";

function isDocxName(fileName: string): boolean {
  return /\.docx?$/i.test(fileName);
}

/** Resolve raw text from a deliverable card. */
export async function resolveCardText(
  client: EaiClient,
  card: DeliverableCard,
): Promise<string> {
  if (card.kind === "inline" && card.content != null) return card.content;
  if (!card.fileId) throw new Error("Нет содержимого для вставки");
  const asHtml = card.importAs === "paste_html" || card.mimeType?.includes("html");
  if (isDocxName(card.fileName)) {
    throw new Error("Для DOCX используйте «Скачать»");
  }
  return downloadVfsText(client, card.fileId, asHtml ? "original" : "md");
}

/** Insert action payload into Word at the given position. */
export async function insertContent(
  client: EaiClient,
  source: ActionContentSource,
  position: InsertPosition,
): Promise<void> {
  if (source.kind === "base64") {
    throw new Error("Для DOCX используйте «Скачать .docx»");
  }
  if (source.kind === "card") {
    const content = await resolveCardText(client, source.card);
    await insertText(content, position, source.card.mimeType);
    return;
  }
  await insertText(source.text, position, source.mimeType);
}
