import type { ActionButtonSpec, ActionTarget } from "./action-buttons-shared";
import { resolveInsertableText } from "./action-buttons-shared";
import { parseR7Proposal } from "./proposal-parse";

/** Word / document family action bar. */
export function resolveDocumentActionButtons(target: ActionTarget): ActionButtonSpec[] {
  const proposal = parseR7Proposal(target.raw);

  if (proposal?.kind === "findings" && proposal.items?.length) {
    return [
      {
        id: "fix_all",
        label: "Все",
        glyph: "✓",
        title: "Исправить все",
        primary: true,
        kind: "apply",
      },
    ];
  }

  if (proposal?.kind === "comment" && (proposal.text || "").trim()) {
    return [
      {
        id: "add_comment",
        label: "Коммент",
        glyph: "💬",
        title: "Добавить комментарий к выделению",
        primary: true,
        kind: "apply",
      },
    ];
  }

  const insertable = resolveInsertableText(target.raw);
  if (!insertable) return [];

  const preferReplace =
    proposal?.kind === "blob" &&
    (proposal.preferReplaceSelection === true || proposal.op === "replace_selection");

  const buttons: ActionButtonSpec[] = [];

  if (preferReplace) {
    buttons.push({
      id: "replace_selection",
      label: "Заменить",
      glyph: "⇄",
      title: "Заменить выделение",
      primary: true,
      kind: "apply",
    });
    buttons.push({
      id: "paste_cursor",
      label: "Курсор",
      glyph: "⎣",
      title: "Вставить у курсора",
      kind: "apply",
    });
  } else {
    buttons.push({
      id: "paste_cursor",
      label: "Курсор",
      glyph: "⎣",
      title: "Вставить у курсора",
      primary: true,
      kind: "apply",
    });
    buttons.push({
      id: "replace_selection",
      label: "Заменить",
      glyph: "⇄",
      title: "Заменить выделение",
      kind: "apply",
    });
  }
  buttons.push({
    id: "paste_end",
    label: "Конец",
    glyph: "↓",
    title: "Вставить в конец",
    kind: "apply",
  });

  buttons.push(
    {
      id: "download_md",
      label: "MD",
      glyph: "⇩",
      title: "Скачать .md",
      kind: "download",
    },
    {
      id: "download_word_html",
      label: "Word",
      glyph: "W",
      title: "Скачать для Word (.html)",
      kind: "download",
    },
  );

  return buttons;
}
