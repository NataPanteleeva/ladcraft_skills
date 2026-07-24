import type { EditorType } from "../config";
import type { EaiClient } from "../eai/client";
import {
  downloadAsWordHtml,
  downloadDocx,
  downloadMarkdown,
  isDocxDownloadSource,
  insertContent,
  type ActionBlock,
  type ActionHandlers,
  type DownloadBlock,
  type InsertPosition,
  type MessageActionPlan,
} from "../apply";
import { withAction } from "../apply/editor-methods";

export type { ActionHandlers } from "../apply";

/** Render contextual action blocks below an assistant message. */
export function renderMessageActions(
  plan: MessageActionPlan,
  handlers: ActionHandlers,
): HTMLElement {
  const wrap = document.createElement("div");
  wrap.className = "message-actions";

  for (const block of plan.blocks) {
    wrap.appendChild(renderActionBlock(block, handlers));
  }

  return wrap;
}

function renderActionBlock(block: ActionBlock, handlers: ActionHandlers): HTMLElement {
  const section = document.createElement("div");
  section.className = "content-actions";

  const title = document.createElement("div");
  title.className = "content-actions-label";
  title.textContent = block.label;
  section.appendChild(title);

  const row = document.createElement("div");
  row.className = "content-actions-row";

  if (block.kind === "insert") {
    if (handlers.editorType === "word") {
      row.appendChild(
        buildButton("В начало документа", () =>
          runInsert(handlers, block.payload, "start"),
        ),
      );
      row.appendChild(
        buildButton("В конец документа", () =>
          runInsert(handlers, block.payload, "end"),
        ),
      );
      row.appendChild(
        buildButton("В позицию курсора", () =>
          runInsert(handlers, block.payload, "cursor"),
        ),
      );
    }
  } else if (block.kind === "download") {
    const downloadBlock = block as DownloadBlock;
    const baseName = downloadBlock.baseName ?? "отчёт";
    const docxSource = downloadBlock.docxPayload;
    const markdownSource =
      docxSource && isDocxDownloadSource(downloadBlock.payload)
        ? undefined
        : downloadBlock.payload;

    if (docxSource) {
      row.appendChild(
        buildButton("Скачать .docx", () =>
          runAction(handlers, () =>
            downloadDocx(handlers.client, docxSource, baseName),
          ),
        ),
      );
    }

    if (markdownSource) {
      row.appendChild(
        buildButton("Скачать .md", () =>
          runAction(handlers, () =>
            downloadMarkdown(handlers.client, markdownSource, baseName),
          ),
        ),
      );
      row.appendChild(
        buildButton("Скачать для Word (.html)", () =>
          runAction(handlers, () =>
            downloadAsWordHtml(handlers.client, markdownSource, baseName),
          ),
        ),
      );
    }

    if (downloadBlock.requestDocx && handlers.onSendMessage) {
      row.appendChild(
        buildButton("Скачать .docx", () =>
          runAction(handlers, () => handlers.onSendMessage!("скачать docx")),
        ),
      );
    }
  }

  section.appendChild(row);
  return section;
}

function buildButton(label: string, fn: () => Promise<void>): HTMLButtonElement {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "content-action-btn";
  btn.textContent = label;
  btn.onclick = () => void fn();
  return btn;
}

async function runInsert(
  handlers: ActionHandlers,
  payload: ActionBlock["payload"],
  position: InsertPosition,
): Promise<void> {
  await runAction(handlers, () =>
    withAction(() => insertContent(handlers.client, payload, position)),
  );
}

async function runAction(
  handlers: ActionHandlers,
  fn: () => Promise<void>,
): Promise<void> {
  try {
    await fn();
    handlers.onStatus?.("Готово");
  } catch (err) {
    handlers.onStatus?.(err instanceof Error ? err.message : String(err));
  }
}

/** Build handlers from app state. */
export function createActionHandlers(options: {
  client: EaiClient;
  editorType: EditorType;
  onStatus?: (message: string) => void;
  onSendMessage?: (text: string) => Promise<void>;
}): ActionHandlers {
  return {
    client: options.client,
    editorType: options.editorType,
    onStatus: options.onStatus,
    onSendMessage: options.onSendMessage,
  };
}
