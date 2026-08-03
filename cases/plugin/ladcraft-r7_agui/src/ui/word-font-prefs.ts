/**
 * Word insert font/size prefs.
 * Applied to PasteHtml for paste / replace_selection — not to plain SearchAndReplace.
 * UI: purple «Aa» badge (left of composer) toggles the panel; panel has × to collapse.
 */

import { getConfig, saveConfig } from "../config";

export interface WordFontDraft {
  family: string;
  sizePt: number;
}

export const WORD_FONT_FAMILIES = [
  "Times New Roman",
  "Arial",
  "Calibri",
] as const;

export const WORD_FONT_SIZES_PT = [10, 11, 12, 14, 16] as const;

const DEFAULT_DRAFT: WordFontDraft = {
  family: "Times New Roman",
  sizePt: 12,
};

function normalizeDraft(raw: Partial<WordFontDraft> | null | undefined): WordFontDraft {
  const family = String(raw?.family || "").trim();
  const sizePt = Number(raw?.sizePt);
  return {
    family: (WORD_FONT_FAMILIES as readonly string[]).includes(family)
      ? family
      : DEFAULT_DRAFT.family,
    sizePt: (WORD_FONT_SIZES_PT as readonly number[]).includes(sizePt)
      ? sizePt
      : DEFAULT_DRAFT.sizePt,
  };
}

/** Current Word paste font prefs (from plugin config). */
export function getWordFontDraft(): WordFontDraft {
  try {
    const cfg = getConfig();
    return normalizeDraft({
      family: cfg.wordFontFamily,
      sizePt: cfg.wordFontSizePt,
    });
  } catch {
    return { ...DEFAULT_DRAFT };
  }
}

/** Persist Word paste font prefs into plugin config. */
export function setWordFontDraft(draft: WordFontDraft): void {
  const next = normalizeDraft(draft);
  saveConfig({
    wordFontFamily: next.family,
    wordFontSizePt: next.sizePt,
  });
}

/**
 * Parse optional «шрифт Times New Roman» / «размер 16» from user text
 * and persist into prefs when found.
 */
export function absorbFontHintsFromUserText(userText: string): WordFontDraft | null {
  const body = String(userText || "");
  if (!body) return null;
  let family: string | null = null;
  let sizePt: number | null = null;

  for (const name of WORD_FONT_FAMILIES) {
    if (body.toLowerCase().includes(name.toLowerCase())) {
      family = name;
      break;
    }
  }
  const sizeM =
    body.match(/(?:размер(?:\s+шрифта)?|size|pt)\s*[:=]?\s*(\d{1,2})\b/i) ||
    body.match(/\b(\d{1,2})\s*pt\b/i);
  if (sizeM) {
    const n = Number(sizeM[1]);
    if ((WORD_FONT_SIZES_PT as readonly number[]).includes(n)) sizePt = n;
    else if (n >= 8 && n <= 72) sizePt = n;
  }
  if (!family && sizePt == null) return null;

  const cur = getWordFontDraft();
  const next: WordFontDraft = {
    family: family || cur.family,
    sizePt: sizePt != null ? sizePt : cur.sizePt,
  };
  if ((WORD_FONT_SIZES_PT as readonly number[]).includes(next.sizePt)) {
    setWordFontDraft(next);
  } else if (family) {
    setWordFontDraft({ family: next.family, sizePt: cur.sizePt });
  }
  return next;
}

/**
 * Wrap PasteHtml payload so Word uses the chosen family/size.
 * Desktop PasteHtml inherits run format from the cursor (often bold after a
 * heading). Char-format getters are unavailable, so **body** `<p>`/`<li>`
 * default to normal weight. Headings and `<strong>` keep intentional bold
 * from chat markdown.
 */
export function wrapHtmlWithWordFont(
  html: string,
  prefs?: WordFontDraft | null,
): string {
  const src = String(html || "").trim();
  if (!src) return src;
  const draft = prefs ? normalizeDraft(prefs) : getWordFontDraft();
  const fam = String(draft.family).replace(/'/g, "");
  const base = `font-family:'${fam}',serif;font-size:${draft.sizePt}pt;`;
  // Body only: reset inheritance. Do not put font-weight:normal on the root —
  // that flattens <strong>/<h*> in Desktop PasteHtml.
  const bodyStyle =
    `${base}font-weight:normal;font-style:normal;text-decoration:none;`;
  const headingStyle =
    `${base}font-weight:bold;font-style:normal;text-decoration:none;`;
  const boldInline = "font-weight:bold;";

  let inner = src;
  if (/^<div\s+data-lc-font=/i.test(inner)) {
    inner = inner
      .replace(/^<div\s+data-lc-font="1"\s+style="[^"]*">/i, "")
      .replace(/<\/div>\s*$/i, "");
  }
  const stamped = stampPasteFontStyles(inner, bodyStyle, headingStyle, boldInline);
  return `<div data-lc-font="1" style="${base}">${stamped}</div>`;
}

function mergeStyleAttr(attrs: string | undefined, style: string): string {
  const a = String(attrs || "");
  if (/\sstyle\s*=/i.test(a) || /^style\s*=/i.test(a.trim())) {
    return a.replace(
      /style\s*=\s*(["'])(.*?)\1/i,
      (_m, q, prev) => `style=${q}${prev};${style}${q}`,
    );
  }
  return ` style="${style}"${a}`;
}

/** Body = normal; headings/strong = bold (preserve chat markdown). */
function stampPasteFontStyles(
  html: string,
  bodyStyle: string,
  headingStyle: string,
  boldInline: string,
): string {
  let out = html.replace(/<(p|li)(\s[^>]*)?>/gi, (_full, tag, attrs) => {
    return `<${tag}${mergeStyleAttr(attrs, bodyStyle)}>`;
  });
  out = out.replace(/<(h[1-6])(\s[^>]*)?>/gi, (_full, tag, attrs) => {
    return `<${tag}${mergeStyleAttr(attrs, headingStyle)}>`;
  });
  out = out.replace(/<(strong|b)(\s[^>]*)?>/gi, (_full, tag, attrs) => {
    return `<${tag}${mergeStyleAttr(attrs, boldInline)}>`;
  });
  return out;
}

/** Small purple «Aa» badge — click toggles the font panel. */
export function renderWordFontTail(options: {
  open: boolean;
  onToggle: () => void;
}): HTMLElement {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = options.open ? "font-tail open" : "font-tail";
  btn.setAttribute("data-font-tail", "1");
  btn.title = "Оформление вставки";
  btn.setAttribute("aria-label", "Оформление вставки");
  btn.setAttribute("aria-expanded", options.open ? "true" : "false");
  btn.textContent = "Aa";
  btn.onclick = (e) => {
    e.preventDefault();
    options.onToggle();
  };
  return btn;
}

/** Font+size panel with × to collapse. */
export function renderWordFontPrefsControls(
  options: { disabled?: boolean; onClose?: () => void } = {},
): HTMLElement {
  const draft = getWordFontDraft();
  const root = document.createElement("div");
  root.className = "font-prefs font-prefs-composer";
  root.setAttribute("data-font-prefs", "composer");

  const head = document.createElement("div");
  head.className = "font-prefs-head";

  const label = document.createElement("div");
  label.className = "font-prefs-label";
  label.textContent = "Оформление вставки";
  head.appendChild(label);

  const closeBtn = document.createElement("button");
  closeBtn.type = "button";
  closeBtn.className = "font-prefs-close";
  closeBtn.setAttribute("aria-label", "Скрыть");
  closeBtn.title = "Скрыть";
  closeBtn.textContent = "×";
  closeBtn.onclick = (e) => {
    e.preventDefault();
    options.onClose?.();
  };
  head.appendChild(closeBtn);
  root.appendChild(head);

  const row = document.createElement("div");
  row.className = "font-prefs-row";

  const familySel = document.createElement("select");
  familySel.className = "font-prefs-select";
  familySel.setAttribute("aria-label", "Шрифт вставки");
  familySel.disabled = Boolean(options.disabled);
  for (const name of WORD_FONT_FAMILIES) {
    const opt = document.createElement("option");
    opt.value = name;
    opt.textContent = name;
    if (name === draft.family) opt.selected = true;
    familySel.appendChild(opt);
  }

  const sizeSel = document.createElement("select");
  sizeSel.className = "font-prefs-select font-prefs-select-size";
  sizeSel.setAttribute("aria-label", "Размер шрифта");
  sizeSel.disabled = Boolean(options.disabled);
  for (const n of WORD_FONT_SIZES_PT) {
    const opt = document.createElement("option");
    opt.value = String(n);
    opt.textContent = `${n} pt`;
    if (n === draft.sizePt) opt.selected = true;
    sizeSel.appendChild(opt);
  }

  const persist = (): void => {
    setWordFontDraft({
      family: familySel.value,
      sizePt: Number(sizeSel.value) || DEFAULT_DRAFT.sizePt,
    });
  };
  familySel.onchange = persist;
  sizeSel.onchange = persist;

  row.appendChild(familySel);
  row.appendChild(sizeSel);
  root.appendChild(row);

  return root;
}
