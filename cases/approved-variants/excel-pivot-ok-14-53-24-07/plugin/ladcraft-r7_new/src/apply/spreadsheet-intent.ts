/** User asked to put result on a new sheet in the open Cell workbook. */
const NEW_SHEET_IN_EDITOR_RE =
  /(?:на\s+новый\s+лист|создай(?:те)?\s+(?:новый\s+)?лист|добавь(?:те)?\s+(?:новый\s+)?лист|вставь(?:те)?\s+на\s+(?:новый\s+)?лист|новый\s+лист\s+(?:с|и)|лист\s+в\s+(?:книге|документе|excel|cell))/i;

/** Replace/overwrite the open sheet table with agent result (not Word selection). */
const REPLACE_OPEN_SHEET_RE =
  /(?:замени(?:те)?|перепиши(?:те)?|обнови(?:те)?|перезапиши(?:те)?)\s+(?:текущ\w*\s+)?(?:таблиц\w*|лист\w*|данн\w*|книг\w*)|(?:замени(?:те)?|перепиши(?:те)?)\s+(?:на\s+)?(?:отсортированн\w*|результат|файл)|запиши(?:те)?\s+(?:результат\s+)?(?:в\s+)?(?:текущ\w*\s+)?(?:лист|таблиц)/i;

const FORMAT_OPEN_SHEET_RE =
  /(?:оформи(?:те)?|форматируй(?:те)?|сделай(?:те)?\s+(?:жирн|шапк)|жирн(?:ый|ой|ую)?\s+шапк|заливка|шрифт|подчеркн|выдели(?:те)?\s+шапк|header\s+bold)/i;

export function wantsNewSheetInOpenWorkbook(userText: string): boolean {
  return NEW_SHEET_IN_EDITOR_RE.test(String(userText || "").trim());
}

export function wantsReplaceOpenSheet(userText: string): boolean {
  return REPLACE_OPEN_SHEET_RE.test(String(userText || "").trim());
}

export function wantsFormatOpenSheet(userText: string): boolean {
  return FORMAT_OPEN_SHEET_RE.test(String(userText || "").trim());
}

export type SpreadsheetOpenSheetIntent = "replace_from_xlsx" | "format" | null;

export function resolveSpreadsheetOpenSheetIntent(
  userText: string,
): SpreadsheetOpenSheetIntent {
  const body = String(userText || "").trim();
  if (!body) return null;
  if (wantsReplaceOpenSheet(body)) return "replace_from_xlsx";
  if (wantsFormatOpenSheet(body)) return "format";
  return null;
}
