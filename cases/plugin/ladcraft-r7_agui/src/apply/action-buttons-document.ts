import type { ActionButtonSpec, ActionId, ActionTarget } from "./action-buttons-shared";
import { actionTargetKey, resolveInsertableText } from "./action-buttons-shared";
import {
  findingsHaveCategoryTags,
  isMechanicalFindingCategory,
} from "./intent-apply";
import { parseR7Proposal } from "./proposal-parse";

const CATEGORY_CHIPS: {
  id: ActionId;
  category: string;
  label: string;
  title: string;
}[] = [
  {
    id: "fix_orthography",
    category: "orthography",
    label: "Орфо",
    title: "Исправить орфографию",
  },
  {
    id: "fix_punctuation",
    category: "punctuation",
    label: "Пункт",
    title: "Исправить пунктуацию",
  },
  {
    id: "fix_grammar",
    category: "grammar",
    label: "Грамм",
    title: "Исправить грамматику",
  },
];

function appliedButton(
  id: ActionId,
  label: string,
  title = "Замены применены",
): ActionButtonSpec {
  return {
    id,
    label,
    glyph: "✓",
    title,
    primary: id === "fix_all",
    kind: "apply",
    applied: true,
    disabled: true,
    chip: true,
  };
}

/** Word / document family action bar. */
export function resolveDocumentActionButtons(
  target: ActionTarget,
  options: {
    appliedActionKeys?: Set<string>;
    /** After «Изменено» flash — hide the button entirely. */
    dismissedActionKeys?: Set<string>;
    /** Finding ids already applied for this proposal (content-stable). */
    appliedFindingIds?: Set<number>;
  } = {},
): ActionButtonSpec[] {
  const proposal = parseR7Proposal(target.raw);
  const applied = options.appliedActionKeys || new Set<string>();
  const dismissed = options.dismissedActionKeys || new Set<string>();
  const appliedIds = options.appliedFindingIds || new Set<number>();

  if (proposal?.kind === "findings" && proposal.items?.length) {
    const items = proposal.items;
    const anyTagged = findingsHaveCategoryTags(items);
    const fixAllKey = actionTargetKey(target, "fix_all");

    // Untagged findings (other agents): single «Все» / «Исправить».
    if (!anyTagged) {
      if (dismissed.has(fixAllKey)) return [];
      const n = items.length;
      const ids = items.map((it) => it.id).sort((a, b) => a - b);
      const idLo = ids[0];
      const idHi = ids[ids.length - 1];
      const label = n === 1 ? "Исправить" : `Все: ${idLo}-${idHi}`;
      if (applied.has(fixAllKey)) {
        return [appliedButton("fix_all", label, "Замены применены")];
      }
      return [
        {
          id: "fix_all",
          label,
          glyph: "✓",
          title: n === 1 ? "Исправить замечание" : `Исправить все (№${idLo}–${idHi})`,
          primary: true,
          kind: "apply",
          chip: n > 1,
        },
      ];
    }

    const remainingMech = items.filter(
      (it) =>
        !appliedIds.has(it.id) && isMechanicalFindingCategory(it.category),
    );
    const allMech = items.filter((it) =>
      isMechanicalFindingCategory(it.category),
    );

    const mechIds = (allMech.length ? allMech : remainingMech)
      .map((it) => it.id)
      .sort((a, b) => a - b);
    const mechLabel =
      mechIds.length === 1
        ? "Исправить"
        : mechIds.length
          ? `Все: ${mechIds[0]}-${mechIds[mechIds.length - 1]}`
          : "Все";

    // Chips already pressed (even if a few Asc hits timed out) → treat category done.
    const categoryChipsDone =
      CATEGORY_CHIPS.filter((chip) =>
        items.some(
          (it) => String(it.category || "").toLowerCase() === chip.category,
        ),
      ).every((chip) => {
        const key = actionTargetKey(target, chip.id);
        if (applied.has(key) || dismissed.has(key)) return true;
        const catItems = items.filter(
          (it) => String(it.category || "").toLowerCase() === chip.category,
        );
        return (
          catItems.length > 0 && catItems.every((it) => appliedIds.has(it.id))
        );
      });

    // Only speech/logic left, or mechanical fully applied — gray «Все», then hide panel.
    if (!remainingMech.length || applied.has(fixAllKey) || categoryChipsDone) {
      if (dismissed.has(fixAllKey)) return [];
      if (
        applied.has(fixAllKey) ||
        categoryChipsDone ||
        allMech.every((it) => appliedIds.has(it.id))
      ) {
        return [appliedButton("fix_all", mechLabel, "Замены применены")];
      }
      return [];
    }

    const ids = remainingMech.map((it) => it.id).sort((a, b) => a - b);
    const idLo = ids[0];
    const idHi = ids[ids.length - 1];
    const rangeLabel =
      ids.length === 1 ? `Все: ${idLo}` : `Все: ${idLo}-${idHi}`;
    const rangeTitle =
      ids.length === 1
        ? `Исправить замечание №${idLo} (орфо/пункт/грамм, без стиля и логики)`
        : `Исправить ${ids.length} замечаний №${idLo}–${idHi} (орфография, пунктуация, грамматика; без стиля и логики)`;

    // Distinct mechanical categories still open (Орфо / Пункт / Грамм).
    const openCatChips = CATEGORY_CHIPS.filter((chip) =>
      remainingMech.some(
        (it) => String(it.category || "").toLowerCase() === chip.category,
      ),
    );

    const buttons: ActionButtonSpec[] = [];

    if (allMech.length === 1 || ids.length === 1) {
      buttons.push({
        id: "fix_all",
        label: "Исправить",
        glyph: "✓",
        title: rangeTitle,
        primary: true,
        kind: "apply",
        chip: true,
      });
    } else {
      buttons.push({
        id: "fix_all",
        label: rangeLabel,
        glyph: "✓",
        title: rangeTitle,
        primary: true,
        kind: "apply",
        chip: true,
      });
    }

    // One category only (e.g. scoped «проверь орфографию») → single «Все», no duplicate Орфо.
    if (openCatChips.length <= 1) {
      return buttons;
    }

    for (const chip of openCatChips) {
      const key = actionTargetKey(target, chip.id);
      if (dismissed.has(key)) continue;
      const catRemaining = remainingMech.filter(
        (it) => String(it.category || "").toLowerCase() === chip.category,
      );
      if (applied.has(key)) {
        buttons.push(appliedButton(chip.id, chip.label, chip.title));
        continue;
      }
      if (!catRemaining.length) continue;
      const catIds = catRemaining.map((it) => it.id).sort((a, b) => a - b);
      const catLo = catIds[0];
      const catHi = catIds[catIds.length - 1];
      buttons.push({
        id: chip.id,
        label: chip.label,
        glyph: "✓",
        title:
          catLo === catHi
            ? `${chip.title} (№${catLo})`
            : `${chip.title} (№${catLo}–${catHi})`,
        primary: false,
        kind: "apply",
        chip: true,
      });
    }

    return buttons;
  }

  if (proposal?.kind === "comment" && (proposal.text || "").trim()) {
    const key = actionTargetKey(target, "add_comment");
    if (applied.has(key)) {
      return [
        {
          id: "add_comment",
          label: "Добавлено",
          glyph: "💬",
          title: "Комментарий уже добавлен",
          primary: true,
          kind: "apply",
          applied: true,
          disabled: false,
        },
      ];
    }
    return [
      {
        id: "add_comment",
        label: "Коммент",
        glyph: "💬",
        title: proposal.search || proposal.anchor
          ? `Добавить комментарий к «${proposal.search || proposal.anchor}»`
          : "Добавить комментарий (поиск якоря или выделение)",
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
      glyph: "↖",
      title: "Вставить у курсора",
      kind: "apply",
    });
  } else {
    buttons.push({
      id: "paste_cursor",
      label: "Курсор",
      glyph: "↖",
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
      label: "HTML",
      glyph: "H",
      title: "Скачать .html",
      kind: "download",
    },
  );

  return buttons;
}
