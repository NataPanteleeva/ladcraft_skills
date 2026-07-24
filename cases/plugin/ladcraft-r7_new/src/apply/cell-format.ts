/**
 * Cell open-sheet format ops applied via Asc.plugin.callCommand + viewport nudge.
 * @see cases/knowledge-base/r7-api-handoff/r7-cell-format-selection-font.md
 */

export type CellFormatTarget = "used" | "selection" | string;

export interface CellFormatSpec {
  bold?: boolean;
  italic?: boolean;
  fontName?: string;
  fontSize?: number;
  /** RGB 0..255 */
  fontColorRgb?: [number, number, number];
  fillRgb?: [number, number, number];
  underline?: string;
  /** First row of used range (header styling). */
  headerBold?: boolean;
  headerFillRgb?: [number, number, number];
  bordersOutline?: boolean;
}

export interface CellFormatProposal {
  target?: CellFormatTarget;
  format: CellFormatSpec;
}

/** Infer a practical format from a short user phrase (no proposal). */
export function inferCellFormatFromUserText(userText: string): CellFormatProposal {
  const t = String(userText || "").toLowerCase();
  const format: CellFormatSpec = {};
  if (/шапк|header|заголов/.test(t)) {
    format.headerBold = true;
    format.headerFillRgb = [240, 240, 240];
  }
  if (/жирн/.test(t) && !format.headerBold) {
    format.bold = true;
  }
  if (/жирн/.test(t) && /шапк|header|заголов/.test(t)) {
    format.headerBold = true;
  }
  if (/подчеркн/.test(t)) {
    format.underline = "single";
  }
  if (/arial/i.test(userText)) {
    format.fontName = "Arial";
  }
  if (/заливка|серым|серую/.test(t) && !format.headerFillRgb) {
    format.fillRgb = [240, 240, 240];
  }
  if (!Object.keys(format).length) {
    format.headerBold = true;
    format.headerFillRgb = [240, 240, 240];
    format.fontName = "Arial";
    format.fontSize = 11;
  }
  let target: CellFormatTarget = "used";
  if (/выделен|selection|выдел/.test(t)) target = "selection";
  return { target, format };
}
