/**
 * Cell open-sheet format: palette + normalize + local intent.
 * Asc apply lives in editor-methods.applyCellFormatSpec.
 */

export type CellFormatTarget = "used" | "selection" | string;

export interface CellFormatSpec {
  bold?: boolean;
  italic?: boolean;
  fontName?: string;
  fontSize?: number;
  /** RGB 0..255 — after normalize always tuple when set */
  fontColorRgb?: [number, number, number] | string;
  fillRgb?: [number, number, number] | string;
  underline?: string;
  headerBold?: boolean;
  headerFillRgb?: [number, number, number] | string;
  bordersOutline?: boolean;
  /** Horizontal align for body/selection: left | center | right */
  align?: string;
  /** Horizontal align for header row only */
  headerAlign?: string;
}

export interface CellFormatProposal {
  target?: CellFormatTarget;
  format: CellFormatSpec;
}

export interface CellFormatRule {
  match?: Record<string, unknown>;
  format?: Record<string, unknown>;
  applyScope?: string;
}

export interface CellFormatSpecInput {
  target?: string;
  range?: string | null;
  cells?: string[] | null;
  format?: Record<string, unknown>;
  rules?: CellFormatRule[] | null;
  applyScope?: string;
  autoFitColumns?: boolean | string | number;
  /** LLM sometimes puts style keys on the root instead of format. */
  bordersOutline?: boolean | string | number;
  headerBold?: boolean | string | number;
  headerFillRgb?: unknown;
  headerAlign?: unknown;
  align?: unknown;
  bold?: boolean | string | number;
  italic?: boolean | string | number;
  fillRgb?: unknown;
  fontColorRgb?: unknown;
  fontName?: unknown;
  fontSize?: unknown;
  underline?: unknown;
}

/** Source of truth for named colors (plugin). Mid/base hues; shades via modifiers. */
export const CELL_COLOR_PALETTE: Record<string, [number, number, number]> = {
  // yellow
  yellow: [255, 255, 0],
  желтый: [255, 255, 0],
  жёлтый: [255, 255, 0],
  // red
  red: [255, 0, 0],
  красный: [255, 0, 0],
  "soft-red": [255, 200, 200],
  // gray (default light header fill; dark/light/pale via modifiers)
  gray: [240, 240, 240],
  grey: [240, 240, 240],
  серый: [240, 240, 240],
  // blue
  blue: [0, 80, 200],
  синий: [0, 80, 200],
  // green
  green: [0, 255, 0],
  зеленый: [0, 255, 0],
  зелёный: [0, 255, 0],
  // white / black
  white: [255, 255, 255],
  белый: [255, 255, 255],
  black: [0, 0, 0],
  чёрный: [0, 0, 0],
  черный: [0, 0, 0],
  // extras
  orange: [255, 140, 0],
  оранжевый: [255, 140, 0],
  purple: [128, 0, 160],
  фиолетовый: [128, 0, 160],
  pink: [255, 105, 180],
  розовый: [255, 105, 180],
  brown: [139, 90, 43],
  коричневый: [139, 90, 43],
  cyan: [0, 180, 200],
  голубой: [70, 160, 230],
  teal: [0, 128, 128],
  бирюзовый: [0, 150, 140],
  navy: [0, 40, 100],
  "тёмно-синий": [0, 40, 100],
  "темно-синий": [0, 40, 100],
  gold: [212, 175, 55],
  золотой: [212, 175, 55],
  silver: [192, 192, 192],
  серебряный: [192, 192, 192],
  beige: [245, 222, 179],
  бежевый: [245, 222, 179],
  olive: [128, 128, 0],
  оливковый: [128, 128, 0],
  magenta: [200, 0, 140],
  малиновый: [200, 0, 80],
  lime: [180, 255, 0],
  лаймовый: [180, 255, 0],
};

type ColorShade = "dark" | "light" | "pale" | "soft" | "bright" | "deep" | null;

const SHADE_PREFIXES: Array<{ re: RegExp; shade: ColorShade }> = [
  { re: /^(т[её]мн[оаяыуеи]*[-_\s]*)/i, shade: "dark" },
  { re: /^(dark[-_\s]*)/i, shade: "dark" },
  { re: /^(глубок[оаяыуеи]*[-_\s]*)/i, shade: "deep" },
  { re: /^(deep[-_\s]*)/i, shade: "deep" },
  { re: /^(светл[оаяыуеи]*[-_\s]*)/i, shade: "light" },
  { re: /^(light[-_\s]*)/i, shade: "light" },
  { re: /^(бледн[оаяыуеи]*[-_\s]*)/i, shade: "pale" },
  { re: /^(pale[-_\s]*)/i, shade: "pale" },
  { re: /^(мягк[оаяыуеи]*[-_\s]*)/i, shade: "soft" },
  { re: /^(soft[-_\s]*)/i, shade: "soft" },
  { re: /^(ярк[оаяыуеи]*[-_\s]*)/i, shade: "bright" },
  { re: /^(bright[-_\s]*)/i, shade: "bright" },
];

/** Normalize color name for lookup: lower, ё→е, collapse separators. */
export function normalizeColorToken(raw: string): string {
  return String(raw || "")
    .trim()
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/[_]+/g, "-")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function stripColorInflection(s: string): string {
  // серым/серую/серого → сер… keep stem long enough for palette keys
  return s
    .replace(/(ыми|ими|ого|его|ому|ему|ыми|ой|ый|ая|ое|ые|ым|ом|ем|ую|юю|им|ых|их)$/i, "")
    .replace(/-$/, "");
}

function applyShade(
  rgb: [number, number, number],
  shade: ColorShade,
): [number, number, number] {
  if (!shade) return rgb;
  const [r, g, b] = rgb;
  const mix3 = (t: number, toward: number): [number, number, number] => [
    clampByte(r + (toward - r) * t),
    clampByte(g + (toward - g) * t),
    clampByte(b + (toward - b) * t),
  ];
  if (shade === "dark" || shade === "deep") return mix3(0.55, 0);
  if (shade === "light") return mix3(0.45, 255);
  if (shade === "pale" || shade === "soft") return mix3(0.7, 255);
  if (shade === "bright") {
    const max = Math.max(r, g, b, 1);
    return [
      clampByte((r / max) * 255),
      clampByte((g / max) * 255),
      clampByte((b / max) * 255),
    ];
  }
  return rgb;
}

function lookupBaseColor(token: string): [number, number, number] | null {
  const candidates = [
    token,
    normalizeColorToken(token),
    stripColorInflection(normalizeColorToken(token)),
  ].filter(Boolean);
  const expanded: string[] = [];
  for (const v of candidates) {
    expanded.push(v, v.replace(/-/g, ""));
  }
  const keys = Object.keys(CELL_COLOR_PALETTE).sort((a, b) => b.length - a.length);
  for (const v of expanded) {
    for (const k of keys) {
      const nk = normalizeColorToken(k);
      if (v === nk || v === nk.replace(/-/g, "") || v === k.toLowerCase()) {
        return [...CELL_COLOR_PALETTE[k]] as [number, number, number];
      }
    }
  }
  // Stem match: сер → серый, син → синий (min 3 chars).
  // Prefer exact stem equality so «сер» does not pick «серебряный» over «серый».
  for (const v of expanded) {
    if (v.length < 3) continue;
    let exact: [number, number, number] | null = null;
    let prefix: [number, number, number] | null = null;
    for (const k of keys) {
      const nk = normalizeColorToken(k).replace(/-/g, "");
      const stem = stripColorInflection(nk).replace(/-/g, "");
      if (stem.length < 3) continue;
      if (v === stem) {
        exact = [...CELL_COLOR_PALETTE[k]] as [number, number, number];
        break;
      }
      if (!prefix && (v.startsWith(stem) || (stem.startsWith(v) && stem.length - v.length <= 2))) {
        prefix = [...CELL_COLOR_PALETTE[k]] as [number, number, number];
      }
    }
    if (exact || prefix) return exact || prefix;
  }
  return null;
}

/** Parse "темно-серый" / "light blue" / "pale-green" → RGB. */
export function resolveNamedColor(raw: string): [number, number, number] | null {
  const original = String(raw || "").trim();
  if (!original) return null;

  // Exact palette keys (with ё and spaces)
  const exactKeys = [
    original.toLowerCase(),
    normalizeColorToken(original),
    original.toLowerCase().replace(/ё/g, "е"),
  ];
  for (const ek of exactKeys) {
    if (CELL_COLOR_PALETTE[ek]) {
      return [...CELL_COLOR_PALETTE[ek]] as [number, number, number];
    }
  }

  let s = normalizeColorToken(original);
  let shade: ColorShade = null;
  for (const { re, shade: sh } of SHADE_PREFIXES) {
    if (re.test(s)) {
      shade = sh;
      s = s.replace(re, "").replace(/^-/, "");
      break;
    }
  }
  if (!shade) {
    if (/^dark/.test(s)) {
      shade = "dark";
      s = s.replace(/^dark/, "");
    } else if (/^light/.test(s)) {
      shade = "light";
      s = s.replace(/^light/, "");
    } else if (/^pale/.test(s)) {
      shade = "pale";
      s = s.replace(/^pale/, "");
    } else if (/^soft/.test(s) && s !== "soft-red" && !s.startsWith("soft-red")) {
      shade = "soft";
      s = s.replace(/^soft/, "");
    }
  }
  s = s.replace(/^-/, "");
  const base = lookupBaseColor(s);
  if (!base) return null;
  return applyShade(base, shade);
}

const COLOR_KEYS = ["fillRgb", "fontColorRgb", "headerFillRgb"] as const;
const ALIGN_KEYS = ["align", "headerAlign"] as const;

export function normalizeAlignValue(val: unknown): "left" | "center" | "right" | null {
  const s = String(val ?? "")
    .trim()
    .toLowerCase();
  if (!s) return null;
  if (s === "center" || s === "centre" || s === "центр" || s.includes("центр")) return "center";
  if (s === "left" || s === "лево" || s.startsWith("лев")) return "left";
  if (s === "right" || s === "право" || s.startsWith("прав")) return "right";
  return null;
}

/**
 * Explicit synonym groups: any token in the group can match any sheet header
 * that equals/contains a group label or token stem.
 */
export const HEADER_SYNONYM_GROUPS: Array<{ tokens: string[]; labels: string[] }> = [
  { tokens: ["оклад", "зарплат", "зп", "salary", "wage"], labels: ["Оклад", "Зарплата"] },
  { tokens: ["преми", "bonus"], labels: ["Премия"] },
  { tokens: ["доход", "revenue", "выручк"], labels: ["Доход", "Выручка"] },
  { tokens: ["sales", "продаж"], labels: ["Sales", "Продажи"] },
  { tokens: ["возраст", "age"], labels: ["Возраст"] },
  { tokens: ["стаж", "experience"], labels: ["Стаж"] },
  { tokens: ["город", "city"], labels: ["Город"] },
  { tokens: ["отдел", "department", "департ"], labels: ["Отдел"] },
  { tokens: ["бюджет", "budget"], labels: ["Бюджет"] },
  { tokens: ["факт", "actual"], labels: ["Факт"] },
  { tokens: ["количеств", "qty", "quantity"], labels: ["Количество"] },
  { tokens: ["цена", "price"], labels: ["Цена"] },
  { tokens: ["сумм", "amount", "total"], labels: ["Сумма"] },
];

const STOP_COLUMN_WORDS = new Set([
  "строк",
  "строки",
  "сотрудник",
  "сотрудников",
  "человек",
  "записи",
  "зеленым",
  "зелёным",
  "желтым",
  "жёлтым",
  "красным",
  "синим",
  "серым",
  "цветом",
  "ячейку",
  "ячейки",
  "колонке",
  "колонки",
  "по",
]);

function clampByte(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(255, Math.round(n)));
}

/** Strip common RU endings for fuzzy header match. */
export function stemHeaderToken(raw: string): string {
  let s = String(raw || "")
    .trim()
    .toLowerCase()
    .replace(/["«»]/g, "");
  if (!s) return "";
  s = s.replace(/(ами|ями|ов|ев|ей|ой|ою|ую|ые|ых|ым|ом|ем|ам|ям|у|е|а|ы|и|ь)$/i, "");
  if (s.length < 3) {
    s = String(raw || "")
      .trim()
      .toLowerCase()
      .replace(/["«»]/g, "");
  }
  return s;
}

/** Expand a header query into aliases (synonym group + stem). */
export function expandHeaderAliases(headerQuery: string): string[] {
  const q = String(headerQuery || "").trim();
  if (!q) return [];
  const stem = stemHeaderToken(q);
  const out: string[] = [];
  const push = (v: string) => {
    const t = String(v || "").trim();
    if (!t) return;
    if (!out.some((x) => x.toLowerCase() === t.toLowerCase())) out.push(t);
  };
  push(q);
  if (stem) push(stem);
  for (const g of HEADER_SYNONYM_GROUPS) {
    const hit = g.tokens.some((tok) => stem.indexOf(tok) >= 0 || tok.indexOf(stem) >= 0);
    if (!hit) continue;
    for (const tok of g.tokens) push(tok);
    for (const lab of g.labels) push(lab);
  }
  return out;
}

function enrichFilterList(filters: unknown): Array<Record<string, unknown>> | undefined {
  if (!Array.isArray(filters)) return undefined;
  return filters
    .filter((f) => f && typeof f === "object" && !Array.isArray(f))
    .map((f) => {
      const row = { ...(f as Record<string, unknown>) };
      const h = String(row.header || "").trim();
      if (h) {
        const aliases = expandHeaderAliases(h);
        const extra = Array.isArray(row.headerAliases)
          ? (row.headerAliases as unknown[]).map((x) => String(x || "").trim()).filter(Boolean)
          : [];
        row.headerAliases = [...aliases, ...extra].filter(
          (v, i, a) => a.findIndex((x) => x.toLowerCase() === v.toLowerCase()) === i,
        );
      }
      return row;
    });
}

function enrichMatchHeaders(match: Record<string, unknown>): Record<string, unknown> {
  const next = { ...match };
  if (next.topN && typeof next.topN === "object" && !Array.isArray(next.topN)) {
    const tn = { ...(next.topN as Record<string, unknown>) };
    const header = String(tn.header || "").trim();
    if (header) {
      const aliases = expandHeaderAliases(header);
      const extra = Array.isArray(tn.headerAliases)
        ? (tn.headerAliases as unknown[]).map((x) => String(x || "").trim()).filter(Boolean)
        : [];
      tn.headerAliases = [...aliases, ...extra].filter(
        (v, i, a) => a.findIndex((x) => x.toLowerCase() === v.toLowerCase()) === i,
      );
    }
    const enrichedFilters = enrichFilterList(tn.filters);
    if (enrichedFilters) tn.filters = enrichedFilters;
    next.topN = tn;
  }
  if (next.extreme && typeof next.extreme === "object" && !Array.isArray(next.extreme)) {
    const ex = { ...(next.extreme as Record<string, unknown>) };
    const header = String(ex.header || "").trim();
    if (header) {
      const aliases = expandHeaderAliases(header);
      const extra = Array.isArray(ex.headerAliases)
        ? (ex.headerAliases as unknown[]).map((x) => String(x || "").trim()).filter(Boolean)
        : [];
      ex.headerAliases = [...aliases, ...extra].filter(
        (v, i, a) => a.findIndex((x) => x.toLowerCase() === v.toLowerCase()) === i,
      );
    }
    const enrichedFilters = enrichFilterList(ex.filters);
    if (enrichedFilters) ex.filters = enrichedFilters;
    next.extreme = ex;
  }
  if (typeof next.header === "string" && next.header.trim()) {
    next.headerAliases = expandHeaderAliases(next.header);
  }
  if (Array.isArray(next.all)) {
    next.all = (next.all as unknown[]).map((c) =>
      c && typeof c === "object" && !Array.isArray(c)
        ? enrichMatchHeaders(c as Record<string, unknown>)
        : c,
    );
  }
  return next;
}

/** Resolve name / HEX / [r,g,b] → RGB. Unknown → null (key dropped). */
export function resolveRgb(val: unknown): [number, number, number] | null {
  if (Array.isArray(val) && val.length >= 3) {
    return [clampByte(Number(val[0])), clampByte(Number(val[1])), clampByte(Number(val[2]))];
  }
  if (typeof val !== "string") return null;
  const raw = val.trim();
  if (!raw) return null;

  const named = resolveNamedColor(raw);
  if (named) return named;

  let hex = raw;
  if (hex.startsWith("#")) hex = hex.slice(1);
  if (/^[0-9a-fA-F]{6}$/.test(hex)) {
    return [
      parseInt(hex.slice(0, 2), 16),
      parseInt(hex.slice(2, 4), 16),
      parseInt(hex.slice(4, 6), 16),
    ];
  }
  if (/^[0-9a-fA-F]{3}$/.test(hex)) {
    return [
      parseInt(hex[0] + hex[0], 16),
      parseInt(hex[1] + hex[1], 16),
      parseInt(hex[2] + hex[2], 16),
    ];
  }
  const m = raw.match(/rgb\s*\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)/i);
  if (m) {
    return [clampByte(Number(m[1])), clampByte(Number(m[2])), clampByte(Number(m[3]))];
  }
  return null;
}

export function normalizeFormatObject(src: unknown): Record<string, unknown> {
  if (!src || typeof src !== "object" || Array.isArray(src)) return {};
  const out: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(src as Record<string, unknown>)) {
    if (COLOR_KEYS.includes(key as (typeof COLOR_KEYS)[number])) {
      const rgb = resolveRgb(val);
      if (rgb) out[key] = rgb;
      continue;
    }
    if (ALIGN_KEYS.includes(key as (typeof ALIGN_KEYS)[number])) {
      const a = normalizeAlignValue(val);
      if (a) out[key] = a;
      continue;
    }
    if (key === "bordersOutline" || key === "headerBold" || key === "bold" || key === "italic") {
      const b = coerceTruthyBool(val);
      if (b !== null) out[key] = b;
      continue;
    }
    out[key] = val;
  }
  return out;
}

function coerceTruthyBool(val: unknown): boolean | null {
  if (val === true || val === false) return val;
  if (typeof val === "number") {
    if (val === 1) return true;
    if (val === 0) return false;
  }
  const s = String(val ?? "")
    .trim()
    .toLowerCase();
  if (["true", "1", "yes", "y", "да", "on"].includes(s)) return true;
  if (["false", "0", "no", "n", "нет", "off", ""].includes(s)) return false;
  return null;
}

/**
 * Plugin SoT normalize before Asc:
 * palette/HEX → RGB, merge root format into empty rule formats, bold→headerBold,
 * expand header synonym aliases.
 */
export function normalizeCellFormatSpec(spec: CellFormatSpecInput): CellFormatSpecInput {
  const target = String(spec.target || "used");
  const applyScope = String(spec.applyScope || "row").toLowerCase() === "cell" ? "cell" : "row";
  const autoFitColumns = coerceTruthyBool(spec.autoFitColumns) === true;
  const formatRaw: Record<string, unknown> = {
    ...((spec.format && typeof spec.format === "object" && !Array.isArray(spec.format)
      ? spec.format
      : {}) as Record<string, unknown>),
  };
  const hoistKeys = [
    "bordersOutline",
    "headerBold",
    "headerFillRgb",
    "headerAlign",
    "align",
    "bold",
    "italic",
    "fillRgb",
    "fontColorRgb",
    "fontName",
    "fontSize",
    "underline",
  ] as const;
  for (const k of hoistKeys) {
    if (formatRaw[k] == null && (spec as Record<string, unknown>)[k] != null) {
      formatRaw[k] = (spec as Record<string, unknown>)[k];
    }
  }
  let format = normalizeFormatObject(formatRaw);
  const rootFmt = { ...format };

  const rulesIn = Array.isArray(spec.rules) ? spec.rules : [];
  const rules: CellFormatRule[] = [];
  for (const rule of rulesIn) {
    if (!rule || typeof rule !== "object") continue;
    const matchRaw =
      rule.match && typeof rule.match === "object" && !Array.isArray(rule.match)
        ? rule.match
        : undefined;
    if (!matchRaw) continue;
    const match = enrichMatchHeaders(matchRaw);
    let rfmt = normalizeFormatObject(rule.format || {});
    if (!Object.keys(rfmt).length && Object.keys(rootFmt).length) {
      rfmt = { ...rootFmt };
    }
    if (!Object.keys(rfmt).length) continue;
    const scope =
      String(rule.applyScope || applyScope).toLowerCase() === "cell" ? "cell" : "row";
    rules.push({ match, format: rfmt, applyScope: scope });
  }

  if (
    target === "used" &&
    format.bold === true &&
    format.headerBold == null &&
    Object.keys(format).every((k) => k === "bold") &&
    !rules.length &&
    !autoFitColumns
  ) {
    format = { headerBold: true };
  }
  if (format.headerBold === true && "bold" in format) {
    const next = { ...format };
    delete next.bold;
    format = next;
  }

  if (rules.length && Object.keys(rootFmt).length) {
    const onlyColors = Object.keys(format).every((k) =>
      COLOR_KEYS.includes(k as (typeof COLOR_KEYS)[number]),
    );
    if (onlyColors) format = {};
  }

  return {
    target,
    range: typeof spec.range === "string" ? spec.range : null,
    cells: Array.isArray(spec.cells) ? spec.cells : null,
    format,
    rules: rules.length ? rules : null,
    applyScope,
    autoFitColumns,
  };
}

function inferFillFromText(t: string): [number, number, number] | null {
  // Prefer full phrase with shade: "темно-серым", "светло-зелёный", "pale blue"
  // Use Cyrillic letter class — JS \w is ASCII-only without the /u flag.
  const L = "[\\w\\u0400-\\u04FF]*";
  const named = t.match(
    new RegExp(
      `((?:т[её]мн${L}|светл${L}|бледн${L}|мягк${L}|ярк${L}|глубок${L}|dark|light|pale|soft|bright|deep)[-_\\s]*)?(зелён${L}|зелен${L}|жёлт${L}|желт${L}|красн${L}|син${L}|сер${L}|оранж${L}|фиолет${L}|розов${L}|коричнев${L}|голуб${L}|бирюз${L}|бежев${L}|золот${L}|серебр${L}|yellow|red|green|blue|gray|grey|orange|purple|pink|brown|cyan|teal|beige|gold|silver)`,
      "i",
    ),
  );
  if (named) {
    const phrase = `${named[1] || ""}${named[2]}`.trim();
    const rgb = resolveNamedColor(phrase);
    if (rgb) return rgb;
  }
  if (/зелён|зелен|green/i.test(t)) return [...CELL_COLOR_PALETTE.green];
  if (/жёлт|желт|yellow/i.test(t)) return [...CELL_COLOR_PALETTE.yellow];
  if (/красн|red/i.test(t)) return [...CELL_COLOR_PALETTE.red];
  if (/син(?:ий|им|юю|его)|blue/i.test(t)) return [...CELL_COLOR_PALETTE.blue];
  if (/сер(?:ый|ым|ую|ого)|gray|grey/i.test(t)) return [...CELL_COLOR_PALETTE.gray];
  if (/оранж|orange/i.test(t)) return [...CELL_COLOR_PALETTE.orange];
  if (/фиолет|purple/i.test(t)) return [...CELL_COLOR_PALETTE.purple];
  if (/розов|pink/i.test(t)) return [...CELL_COLOR_PALETTE.pink];
  return null;
}

/** Extract column token after низк/высок/… or quoted name; fall back to synonym hit. */
export function extractHeaderQueryFromText(userText: string): string | null {
  const raw = String(userText || "").trim();
  if (!raw) return null;

  const quoted = raw.match(/["«]([^"»]+)["»]/);
  if (quoted && quoted[1].trim()) return quoted[1].trim();

  const afterAdj = raw.match(
    /(?:низк|высок|выск|меньш|больш|наибольш|наименьш)[\w\u0400-\u04FF]*\s+(?:по\s+(?:колонк[\w\u0400-\u04FF]*\s+)?)?([A-Za-zА-Яа-яЁё][\w\u0400-\u04FF\-]*)/i,
  );
  if (afterAdj && afterAdj[1]) {
    const tok = afterAdj[1].trim();
    const stem = stemHeaderToken(tok);
    if (tok && !STOP_COLUMN_WORDS.has(tok.toLowerCase()) && stem.length >= 3) {
      for (const g of HEADER_SYNONYM_GROUPS) {
        const hit = g.tokens.some(
          (t) => stem.indexOf(t) >= 0 || t.indexOf(stem) >= 0 || tok.toLowerCase().indexOf(t) >= 0,
        );
        if (hit && g.labels[0]) return g.labels[0];
      }
      return tok;
    }
  }

  const t = raw.toLowerCase();
  for (const g of HEADER_SYNONYM_GROUPS) {
    for (const tok of g.tokens) {
      if (t.indexOf(tok) >= 0) return g.labels[0] || tok;
    }
  }
  return null;
}

export interface CellFormatLocalIntent {
  spec: CellFormatSpecInput;
  summary: string;
}

export interface LastLocalCellFormat {
  summary: string;
  spec: CellFormatSpecInput;
  ascSummary?: string;
  at: number;
}

/** Compact supplement for agent POST when local format already ran. */
export function formatLastLocalCellFormatBlock(last: LastLocalCellFormat): string {
  const spec = last.spec || {};
  const scope = String(spec.applyScope || "row");
  const rules = Array.isArray(spec.rules) ? spec.rules : [];
  const lines: string[] = [
    "---",
    "[Контекст R7: последнее оформление листа]",
    `summary: ${last.summary || "Применено"}`,
    `scope: ${scope}`,
  ];
  if (spec.autoFitColumns) lines.push("autoFitColumns: true");
  for (let i = 0; i < rules.length; i++) {
    const rule = rules[i] || {};
    const match = (rule.match || {}) as Record<string, unknown>;
    const rfmt = (rule.format || {}) as Record<string, unknown>;
    const rScope = String(rule.applyScope || scope);
    if (match.topN && typeof match.topN === "object") {
      const tn = match.topN as Record<string, unknown>;
      lines.push(
        `match: topN header=${tn.header || ""} n=${tn.n || ""} order=${tn.order || "asc"}`,
      );
      if (Array.isArray(tn.filters) && tn.filters.length) {
        for (const f of tn.filters as Array<Record<string, unknown>>) {
          lines.push(`filter: ${f.header || ""} ${f.op || "eq"} ${f.value ?? ""}`);
        }
      }
    } else if (match.extreme && typeof match.extreme === "object") {
      const ex = match.extreme as Record<string, unknown>;
      lines.push(`match: extreme header=${ex.header || ""} which=${ex.which || "max"}`);
      if (Array.isArray(ex.filters) && ex.filters.length) {
        for (const f of ex.filters as Array<Record<string, unknown>>) {
          lines.push(`filter: ${f.header || ""} ${f.op || "eq"} ${f.value ?? ""}`);
        }
      }
    } else if (Array.isArray(match.all)) {
      lines.push(`match: all(${match.all.length})`);
    } else if (match.header || match.col != null) {
      lines.push(
        `match: ${match.header || match.col} op=${match.op || "eq"} value=${match.value ?? ""}`,
      );
    }
    if (rfmt.fillRgb != null) {
      lines.push(`fill: ${JSON.stringify(rfmt.fillRgb)}`);
    }
    lines.push(`ruleScope: ${rScope}`);
  }
  if (last.ascSummary) lines.push(`asc: ${last.ascSummary}`);
  lines.push("---");
  return lines.join("\n");
}

export function appendLastLocalFormatSupplement(
  userText: string,
  last: LastLocalCellFormat | null | undefined,
): string {
  if (!last || !last.spec) return userText;
  // Skip stale (>2h)
  if (last.at && Date.now() - last.at > 2 * 60 * 60 * 1000) return userText;
  const block = formatLastLocalCellFormatBlock(last);
  if (!block.trim()) return userText;
  return `${String(userText || "").trim()}\n\n${block}`;
}

/** «только ячейки / не строки» without a new topN/color — redo last as cell scope. */
export function wantsCellScopeOnlyRedo(userText: string): boolean {
  const t = String(userText || "").toLowerCase();
  if (!t.trim()) return false;
  // New ranking / color → full infer path, not redo.
  if (
    /(\d+)\s*(?:сотрудник|строк|чел|сам)/i.test(t) &&
    /(?:низк|высок|меньш|больш)/i.test(t)
  ) {
    return false;
  }
  if (/зелён|зелен|жёлт|желт|красн|син(?:ий|им)|сер(?:ый|ым)/i.test(t) && /выдели|закрась/.test(t)) {
    return false;
  }
  return (
    /только\s+ячейк/i.test(t) ||
    /не\s+строк/i.test(t) ||
    /убери[\s\S]{0,40}строк[\s\S]{0,40}ячейк/i.test(t) ||
    /выдели[\s\S]{0,20}только\s+ячейк/i.test(t) ||
    /вместо\s+строк/i.test(t)
  );
}

/** Clone last format spec with applyScope=cell on rules. */
export function rebuildSpecAsCellScope(spec: CellFormatSpecInput): CellFormatSpecInput {
  const rulesIn = Array.isArray(spec.rules) ? spec.rules : [];
  const rules = rulesIn.map((rule) => ({
    ...rule,
    applyScope: "cell",
    match: rule.match ? { ...rule.match } : rule.match,
    format: rule.format ? { ...rule.format } : rule.format,
  }));
  return {
    ...spec,
    applyScope: "cell",
    rules: rules.length ? rules : null,
  };
}

function scopeUnit(scope: string, n: number): string {
  if (scope === "cell") return n === 1 ? "ячейка" : "ячеек";
  return n === 1 ? "строка" : "строк";
}

/** «для Екатеринбурга» / «в Москве» → filter on Город. */
const PLACE_FILTER_RE =
  /(?:для|в|по\s+городу)\s+([А-ЯЁA-Z][а-яёa-zA-Z\-]+(?:\-[А-ЯЁA-Z]?[а-яёa-zA-Z\-]+)?)/;

export function extractPlaceFilterFromText(
  userText: string,
): { header: string; op: string; value: string; headerAliases: string[] } | null {
  const raw = String(userText || "").trim();
  if (!raw) return null;
  const m = raw.match(PLACE_FILTER_RE);
  if (!m || !m[1]) return null;
  let value = m[1].trim();
  value = value.replace(/(а|я|у|ю|ом|ем|е|и|ы|ой|ей|ам|ям|ами|ями|ах|ях)$/i, "");
  if (value.length < 3) value = m[1].trim();
  return {
    header: "Город",
    op: "contains",
    value,
    headerAliases: expandHeaderAliases("Город"),
  };
}

/**
 * Parse typical RU phrases → cell_format spec (0 LLM).
 * Returns null when phrase is not a clear local format intent.
 */
const WORD = "[\\w\\u0400-\\u04FF]*";

export function inferCellFormatIntentFromUserText(
  userText: string,
): CellFormatLocalIntent | null {
  const raw = String(userText || "").trim();
  if (!raw) return null;
  const t = raw.toLowerCase();

  if (
    /раздвинь|подгони\s+ширин|autofit|автоподбор\s+ширин|ширин[\w\u0400-\u04FF]*\s+колон/i.test(
      t,
    ) &&
    !isCompoundTableStyleRequest(t)
  ) {
    return {
      spec: { target: "used", autoFitColumns: true, format: {}, rules: null },
      summary: "Применено: ширина колонок подогнана",
    };
  }

  const fill = inferFillFromText(t);
  const header = extractHeaderQueryFromText(raw);
  const aliases = header ? expandHeaderAliases(header) : [];
  const placeFilter = extractPlaceFilterFromText(raw);
  const nRe = new RegExp(
    `(\\d+)\\s*(?:сотрудник${WORD}|строк${WORD}|чел(?:овек)?${WORD}|записи?${WORD})?\\s*(?:с\\s+)?сам${WORD}`,
    "i",
  );
  const nAltRe = new RegExp(
    `сам${WORD}\\s+(?:низк|высок|выск|меньш|больш|наибольш|наименьш)${WORD}.*?(\\d+)`,
    "i",
  );
  const nFind = t.match(
    /(?:найди|найти|покажи|выбери)\s*(\d+)\s*(?:сам|сотрудник|строк)?/i,
  );
  const nTop = t.match(/топ-?\s*(\d+)/i);
  const nMatch = t.match(nRe);
  const nAlt = t.match(nAltRe);
  const n = nTop
    ? Math.max(1, parseInt(nTop[1], 10) || 0)
    : nMatch
      ? Math.max(1, parseInt(nMatch[1], 10) || 0)
      : nAlt
        ? Math.max(1, parseInt(nAlt[1], 10) || 0)
        : nFind
          ? Math.max(1, parseInt(nFind[1], 10) || 0)
          : 0;

  // Typo-tolerant: «выскоих» ≈ высоких; bare «топ N» without «низк» → high.
  const low = /низк|меньш|наименьш|smallest|lowest|min\b/i.test(t);
  const high =
    /высок|выск|больш|наибольш|largest|highest|max\b/i.test(t) ||
    (/топ-?\s*\d+/i.test(t) && !low);

  const wantsHighlight =
    /выдели|закрась|закраши|окрась|окраши|подсвет|заливка|зелён|зелен|жёлт|желт|красн|найди|найти/i.test(
      t,
    );

  if (wantsHighlight && header && n >= 1 && (low || high)) {
    const order = low && !high ? "asc" : "desc";
    const color = fill || CELL_COLOR_PALETTE.yellow;
    const colorName =
      color[1] === 255 && color[0] === 0
        ? "зелёным"
        : color[0] === 255 && color[1] === 255
          ? "жёлтым"
          : color[0] === 255 && color[1] === 0
            ? "красным"
            : "цветом";
    const scope = /ячейк/i.test(t) ? "cell" : "row";
    const topN: Record<string, unknown> = {
      header,
      n,
      order,
      headerAliases: aliases,
    };
    if (placeFilter) {
      topN.filters = [
        {
          header: placeFilter.header,
          op: placeFilter.op,
          value: placeFilter.value,
          headerAliases: placeFilter.headerAliases,
        },
      ];
    }
    const placeNote = placeFilter ? ` (${placeFilter.value})` : "";
    return {
      spec: {
        target: "used",
        applyScope: scope,
        format: {},
        rules: [
          {
            match: { topN },
            format: { fillRgb: color },
            applyScope: scope,
          },
        ],
      },
      summary: `Применено: выделено ${n} ${scopeUnit(scope, n)} по «${header}»${placeNote} ${colorName}`,
    };
  }

  if (
    wantsHighlight &&
    header &&
    new RegExp(`сам${WORD}\\s+(высок|выск|низк|больш|меньш|наибольш|наименьш)`, "i").test(t) &&
    n < 1
  ) {
    const which = /низк|меньш|наименьш/i.test(t) ? "min" : "max";
    const color = fill || CELL_COLOR_PALETTE.yellow;
    const scope = /ячейк/i.test(t) ? "cell" : "row";
    const extreme: Record<string, unknown> = {
      header,
      which,
      headerAliases: aliases,
    };
    if (placeFilter) {
      extreme.filters = [
        {
          header: placeFilter.header,
          op: placeFilter.op,
          value: placeFilter.value,
          headerAliases: placeFilter.headerAliases,
        },
      ];
    }
    const placeNote = placeFilter ? ` (${placeFilter.value})` : "";
    return {
      spec: {
        target: "used",
        applyScope: scope,
        format: {},
        rules: [
          {
            match: { extreme },
            format: { fillRgb: color },
            applyScope: scope,
          },
        ],
      },
      summary: `Применено: выделена ${scope === "cell" ? "ячейка" : "строка"} с ${which === "min" ? "мин." : "макс."} «${header}»${placeNote}`,
    };
  }

  // Multi-part table styling — apply locally (do not rely on LLM remembering autoFitColumns).
  if (isCompoundTableStyleRequest(t)) {
    return buildCompoundTableStyleIntent(raw, t);
  }

  // Simple: horizontal align (header or whole table).
  if (/выравн|по\s+центр|align|слева|справа|по\s+левому|по\s+правому/i.test(t)) {
    let align: "left" | "center" | "right" | null = null;
    if (/центр|center/i.test(t)) align = "center";
    else if (/лев|left/i.test(t)) align = "left";
    else if (/прав|right/i.test(t)) align = "right";
    if (align) {
      const onHeader = /шапк|заголов|header/i.test(t);
      if (onHeader) {
        return {
          spec: {
            target: "used",
            format: { headerAlign: align },
            rules: null,
          },
          summary:
            align === "center"
              ? "Применено: шапка по центру"
              : align === "left"
                ? "Применено: шапка слева"
                : "Применено: шапка справа",
        };
      }
      return {
        spec: {
          target: "used",
          format: { align },
          rules: null,
        },
        summary:
          align === "center"
            ? "Применено: выравнивание по центру"
            : align === "left"
              ? "Применено: выравнивание слева"
              : "Применено: выравнивание справа",
      };
    }
  }

  // Simple single-purpose: bold header only.
  if (
    /жирн[\w\u0400-\u04FF]*\s+шапк|шапк[\w\u0400-\u04FF]*\s+жирн|header\s+bold/i.test(t) &&
    !/сер|фон|ширин|рамк|границ|autofit|по\s+содержим/i.test(t)
  ) {
    return {
      spec: {
        target: "used",
        format: { headerBold: true },
        rules: null,
      },
      summary: "Применено: шапка выделена жирным",
    };
  }

  return null;
}

/** True when user asked to fit column widths to content. */
export function userTextWantsAutoFitColumns(userText: string): boolean {
  const t = String(userText || "").toLowerCase();
  return /ширин|autofit|по\s+содержим|раздвинь|подгони\s+(?:ширин|колон)|автоподбор\s+ширин/i.test(
    t,
  );
}

/** Build one local cell_format from a multi-goal style phrase. */
export function buildCompoundTableStyleIntent(
  raw: string,
  tLower?: string,
): CellFormatLocalIntent {
  const t = (tLower || String(raw || "").toLowerCase()).trim();
  const format: Record<string, unknown> = {};
  const parts: string[] = [];

  const headerColorAsk =
    /шапк|заголов|header/i.test(t) &&
    /сер|зел|жёлт|желт|красн|син|фон|заливк|цвет|gray|grey|yellow|red|green|blue/i.test(t);
  const fill = inferFillFromText(t);
  if (headerColorAsk || (/оформи|форматируй/i.test(t) && fill && /шапк|заголов/i.test(t))) {
    format.headerFillRgb = fill || CELL_COLOR_PALETTE.серый;
    format.headerBold = true;
    format.headerAlign = "center";
    parts.push("шапка");
  } else if (/жирн[\w\u0400-\u04FF]*\s+шапк|шапк[\w\u0400-\u04FF]*\s+жирн|header\s+bold/i.test(t)) {
    format.headerBold = true;
    parts.push("жирная шапка");
  }

  if (/рамк|границ|borders|обводк/i.test(t)) {
    format.bordersOutline = true;
    parts.push("границы");
  }

  if (/выравн|по\s+центр|слева|справа|align/i.test(t) && !format.headerAlign) {
    if (/центр|center/i.test(t)) {
      if (/шапк|заголов|header/i.test(t)) format.headerAlign = "center";
      else format.align = "center";
      parts.push("выравнивание");
    } else if (/лев|left/i.test(t)) {
      if (/шапк|заголов|header/i.test(t)) format.headerAlign = "left";
      else format.align = "left";
      parts.push("выравнивание");
    } else if (/прав|right/i.test(t)) {
      if (/шапк|заголов|header/i.test(t)) format.headerAlign = "right";
      else format.align = "right";
      parts.push("выравнивание");
    }
  }

  const autoFit = userTextWantsAutoFitColumns(t);
  if (autoFit) parts.push("ширина по содержимому");

  // «оформи таблицу» alone with one style goal — still apply what we parsed.
  if (!Object.keys(format).length && !autoFit) {
    format.headerBold = true;
    format.headerFillRgb = fill || CELL_COLOR_PALETTE.серый;
    format.headerAlign = "center";
    parts.push("шапка");
  }

  return {
    spec: {
      target: "used",
      autoFitColumns: autoFit,
      format,
      rules: null,
    },
    summary: parts.length
      ? `Оформление применено: ${parts.join(", ")}`
      : "Оформление применено",
  };
}

/** Two+ style goals in one phrase → local compound apply (not agent). */
export function isCompoundTableStyleRequest(userText: string): boolean {
  const t = String(userText || "").toLowerCase();
  if (!t.trim()) return false;
  let goals = 0;
  if (/жирн[\w\u0400-\u04FF]*\s+шапк|шапк[\w\u0400-\u04FF]*\s+жирн|header\s+bold|жирн[\w\u0400-\u04FF]*\s+цвет/i.test(t)) {
    goals += 1;
  }
  // «шапку темно-серым», «серый фон шапки», «залей шапку»
  if (
    /сер(?:ый|ым|ую|ого)?\s+фон|фон\s+сер|заливк[\w\u0400-\u04FF]*\s+шапк|шапк[\w\u0400-\u04FF]*\s+(?:сер|залив)|шапк[\w\u0400-\u04FF]*.{0,24}сер|сер\w*.{0,24}шапк|шапк[\w\u0400-\u04FF]*.{0,24}(?:т[её]мн\w*[-_\s]*)?сер/i.test(
      t,
    )
  ) {
    goals += 1;
  }
  if (userTextWantsAutoFitColumns(t)) {
    goals += 1;
  }
  if (/рамк|границ|borders|обводк/i.test(t)) {
    goals += 1;
  }
  if (/выравн|по\s+центр|слева|справа|align/i.test(t)) {
    goals += 1;
  }
  if (/оформи[\w\u0400-\u04FF]*\s+таблиц|форматируй[\w\u0400-\u04FF]*\s+таблиц/i.test(t) && goals >= 1) {
    return true;
  }
  // Comma / dash list of style asks
  if (goals >= 2) return true;
  if (goals >= 1 && /[,;]| - | — /.test(userText) && /шапк|ширин|рамк|фон|жирн/.test(t)) {
    return goals >= 2 || /оформи|форматируй/.test(t);
  }
  return false;
}

/** Legacy simple infer (header/bold/fill) — kept for callers. */
export function inferCellFormatFromUserText(userText: string): CellFormatProposal {
  const intent = inferCellFormatIntentFromUserText(userText);
  if (intent?.spec.format && Object.keys(intent.spec.format).length) {
    return {
      target: (intent.spec.target as CellFormatTarget) || "used",
      format: intent.spec.format as CellFormatSpec,
    };
  }
  const t = String(userText || "").toLowerCase();
  const format: CellFormatSpec = {};
  if (/шапк|header|заголов/.test(t)) {
    format.headerBold = true;
    format.headerFillRgb = [240, 240, 240];
  }
  if (/жирн/.test(t) && !format.headerBold) {
    format.bold = true;
  }
  if (/подчеркн/.test(t)) {
    format.underline = "single";
  }
  if (/arial/i.test(userText)) {
    format.fontName = "Arial";
  }
  const fill = inferFillFromText(t);
  if (fill && !format.headerFillRgb) {
    format.fillRgb = fill;
  }
  if (!Object.keys(format).length) {
    format.headerBold = true;
    format.headerFillRgb = [240, 240, 240];
  }
  let target: CellFormatTarget = "used";
  if (/выделен|selection|выдел/.test(t)) target = "selection";
  return { target, format };
}
