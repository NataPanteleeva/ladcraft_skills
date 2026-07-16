import { isValidVfsFileId } from "../eai/vfs";
import type { DeliverableCard } from "./deliverable";
import type {
  DeliverAction,
  R7DeliverFileTask,
  R7DeliverInlineTask,
  R7ShareLinkTask,
  R7Task,
} from "./task-parse";
import { isCompareReportPayloadTask } from "./compare-report";
import { isExportCardTask } from "./task-parse";

let deliverableSeq = 0;

function nextId(): string {
  deliverableSeq += 1;
  return `deliver-hist-${deliverableSeq}`;
}

function normalizeActions(actions: DeliverAction[] | undefined, mimeType?: string): DeliverAction[] {
  if (actions?.length) return actions;
  if (mimeType?.includes("html")) return ["download", "paste"];
  return ["download", "paste_text"];
}

/** Build UI cards from parsed tasks (no API calls). Excludes compare-report JSON carriers. */
export function buildDeliverablesFromTasks(tasks: R7Task[]): DeliverableCard[] {
  const cards: DeliverableCard[] = [];
  for (const task of tasks) {
    if (isCompareReportPayloadTask(task)) continue;
    switch (task.type) {
      case "deliver_inline":
        cards.push(buildInlineCard(task));
        break;
      case "deliver_file": {
        const card = buildVfsCard(task);
        if (card) cards.push(card);
        break;
      }
      case "share_link": {
        const card = buildShareCard(task);
        if (card) cards.push(card);
        break;
      }
      default:
        break;
    }
  }
  return cards;
}

/** True when assistant message includes export deliverables. */
export function hasExportDeliverables(
  tasks: R7Task[],
  deliverables?: DeliverableCard[],
): boolean {
  if (deliverables?.length) return true;
  return tasks.some((t) => isExportCardTask(t.type));
}

function buildInlineCard(task: R7DeliverInlineTask): DeliverableCard {
  return {
    id: nextId(),
    kind: "inline",
    fileName: task.data.fileName,
    mimeType: task.data.mimeType,
    content: task.data.content,
    actions: normalizeActions(task.data.actions, task.data.mimeType),
  };
}

function buildVfsCard(task: R7DeliverFileTask): DeliverableCard | null {
  if (!isValidVfsFileId(task.data.fileId)) return null;
  return {
    id: nextId(),
    kind: "vfs",
    fileName: task.data.fileName,
    mimeType: task.data.mimeType,
    fileId: task.data.fileId,
    actions: normalizeActions(task.data.actions, task.data.mimeType),
    importAs: task.data.importAs ?? null,
  };
}

function buildShareCard(task: R7ShareLinkTask): DeliverableCard | null {
  if (!isValidVfsFileId(task.data.fileId)) return null;
  return {
    id: nextId(),
    kind: "share",
    fileName: task.data.fileName ?? "файл",
    label: task.data.label ?? "Скачать",
    fileId: task.data.fileId,
    actions: ["share_link", "download"],
  };
}
