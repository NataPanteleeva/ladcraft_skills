import type { ChatMessage } from "../ui/chat";
import {
  listLatestAssistantDeliverables,
  resolveSelectedAgentDeliverable,
} from "./agent-deliverables";
import type { ActionButtonSpec, ActionTarget } from "./action-buttons-shared";
import { parseR7Proposal } from "./proposal-parse";

/** Cell / spreadsheet family action bar (matrix from VFS .xlsx, not chat summary). */
export function resolveSpreadsheetActionButtons(
  target: ActionTarget | null,
  messages: ChatMessage[],
  options: {
    history?: Parameters<typeof listLatestAssistantDeliverables>[1];
    selectedPath?: string | null;
    excludePath?: string | null;
  } = {},
): ActionButtonSpec[] {
  const buttons: ActionButtonSpec[] = [];
  const listed = listLatestAssistantDeliverables(messages, options.history, {
    excludePath: options.excludePath,
  });
  const selected = resolveSelectedAgentDeliverable(
    messages,
    options.history,
    options.selectedPath,
    { excludePath: options.excludePath },
  );
  const deliverables = selected ? [selected] : listed.slice(0, 1);

  if (deliverables.length > 0 || listed.length > 0) {
    const fileName = (selected || listed[0]).fileName;
    const multi = listed.length > 1 ? ` (${listed.length} файлов — выберите выше)` : "";
    buttons.push({
      id: "download_vfs_xlsx",
      label: "XLSX",
      glyph: "▦",
      title: `Скачать ${fileName}${multi}`,
      primary: true,
      kind: "download",
    });
    buttons.push({
      id: "sheet_from_xlsx",
      label: "Лист",
      glyph: "⧉",
      title: "Записать выбранный итог на новый лист (можно повторять)",
      kind: "apply",
    });
    buttons.push({
      id: "paste_xlsx_matrix",
      label: "Вставить",
      glyph: "⎣",
      title: "Вставить выбранную матрицу у активной ячейки (можно повторять)",
      kind: "apply",
    });
    buttons.push({
      id: "replace_active_sheet",
      label: "Заменить",
      glyph: "↻",
      title: "Очистить текущий лист (used range) и записать выбранный итог с A1",
      kind: "apply",
    });
    buttons.push({
      id: "download_csv",
      label: "CSV",
      glyph: "⊞",
      title: "Скачать выбранную таблицу (.csv)",
      kind: "download",
    });
  }

  if (target) {
    const proposal = parseR7Proposal(target.raw);
    if (proposal?.kind === "cell_map" && proposal.data) {
      buttons.unshift({
        id: "cell_write",
        label: "Запись",
        glyph: "▦",
        title: "Записать в таблицу",
        primary: listed.length === 0,
        kind: "apply",
      });
    }
  }

  return buttons;
}
