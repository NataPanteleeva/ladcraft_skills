/**
 * Local (0 LLM) help replies: capabilities + howto.
 * SoT:
 * - spreadsheet: cases/excel_pivot_report/excel_pivot_agent/spravka-*.md
 * - lca: cases/LCA/agent/spravka-*.md
 */

export type LocalHelpKind = "capabilities" | "howto";

export type LocalHelpProfile = "spreadsheet" | "lca";

/** Prod agent id: Р7. Работа с таблицами (Excel / Cell). */
export const SPREADSHEET_AGENT_ID = "UsL7iqdQLBtYpmP0s7dWF";

/** Prod agent id: Лингвистическая проверка текстов (LCA). */
export const LCA_AGENT_ID = "f5BwCaKDeDDG71zHJPvid";

export const HELP_HOWTO_HASH = "#r7-help-howto";

export const HELP_CAPABILITIES_HASH = "#r7-help-capabilities";

/** Shown immediately when opening spreadsheet agent chat (no user text). */
export const HELP_START_MD_SPREADSHEET = `**Я — ассистент для работы с таблицами Excel в R7 Cell.**

✨ [Что я умею](${HELP_CAPABILITIES_HASH})
🧭 [Как работать](${HELP_HOWTO_HASH})
`;

/** Shown immediately when opening LCA agent chat (no user text). */
export const HELP_START_MD_LCA = `**Я — ассистент для работы с текстом в редакторе документов R7 Word.**

✨ [Что я умею](${HELP_CAPABILITIES_HASH})
🧭 [Как работать](${HELP_HOWTO_HASH})
`;

/** @deprecated use HELP_START_MD_SPREADSHEET or helpStartMarkdown(profile) */
export const HELP_START_MD = HELP_START_MD_SPREADSHEET;

export const HELP_CAPABILITIES_MD_SPREADSHEET = `# Р7. Работа с таблицами

Я — ассистент для работы с **таблицами Excel в R7 Cell**: от подготовки данных до сводных и аккуратного вида листа — без ручной рутины в меню.

## ✨ Что умею

| | Направление | Что делаю |
|---|-------------|-----------|
| 📊 | **Сводные и KPI** | Сводные таблицы, топ‑N, ключевые показатели |
| 🔧 | **Данные** | Фильтр, сортировка, дубликаты, колонки, расчёты |
| 🎨 | **Оформление** | Шапка, цвета, выравнивание, рамки, ширина колонок |
| 📎 | **Открытый лист** | Правки формата прямо в R7 Cell через плагин |

**Результат:** готовый файл (\`Файл:\`) или изменения на листе.

[Как работать](${HELP_HOWTO_HASH})
`;

export const HELP_HOWTO_MD_SPREADSHEET = `# Как работать с Р7. Работа с таблицами

## ⏱️ Главное за 15 секунд

| № | Что происходит |
|---|----------------|
| 1️⃣ | Вы пишете **цель** (что отобрать / посчитать / оформить) |
| 2️⃣ | Я готовлю результат: **файл** или **формат на листе** |
| 3️⃣ | Если есть **\`Файл:\`** — вставка в книгу **не автоматическая** |
| 4️⃣ | В панели плагина: **выбрать таблицу** (если вариантов несколько) → нажать кнопку действия |

## 🗂️ Когда вариантов несколько

В одном ответе часто несколько листов/файлов, например:

| Вариант | Обычно это |
|---------|------------|
| **Сводная** | сводная таблица |
| **Топ** | рейтинг / top‑N |
| **KPI** | ключевые показатели |
| **Фильтр** | отфильтрованные строки |

Над кнопками появится строка **«Выберите таблицу:»** с чипами.

**Порядок:** сначала выберите нужный вариант → потом кнопку (**Лист** / **Вставить** / …). Иначе может вставиться не тот результат.

## 📈 Какую аналитику можно сделать

Спросите, например: «какую аналитику можно по этому файлу?»

- Предложу **2–4 варианта** текстом (срезы, сводные, топы).
- Можно выбрать один или попросить **несколько / все подходящие**.
- После ответа над кнопками появятся **варианты таблиц** — выберите чип, затем кнопку действия.

## 🎛️ Кнопки плагина (после \`Файл:\`)

| | Кнопка | Что делает |
|---|--------|------------|
| ▦ | **XLSX** | Скачать выбранный результат |
| ⧉ | **Лист** | Записать на **новый** лист книги |
| ⎣ | **Вставить** | Вставить у **активной** ячейки |
| ↻ | **Заменить** | Очистить текущий лист и записать с A1 |
| ⊞ | **CSV** | Скачать выбранную таблицу как CSV |

## 🎨 Оформление (цвет, шапка, рамка)

Если просите оформить **открытый** лист — плагин применяет формат **сам**. Отдельная кнопка вставки для этого обычно **не нужна**.

## ✍️ Как формулировать запрос

**Цель + поле/условие + вид (если нужно)**
Примеры:
- \`Сделай сводную по двум полям и сумму по показателю\`
- \`Оставь строки по условию и отсортируй по столбцу\`
- \`Выдели топ-N по показателю цветом\`
- \`Шапка серая, жирная, по центру, рамка, ширина по содержимому\`

## ❓ Если что-то неясно

Коротко уточните: какой лист, какое поле, какое условие — и продолжим.
`;

export const HELP_CAPABILITIES_MD_LCA = `# Лингвистическая проверка текстов (LCA)

Я — ассистент для работы с **текстом в редакторе документов R7 Word**: проверка по правилам Заказчика, создание фрагментов и правка открытого документа — без ручной рутины в меню.

## ✨ Что умею

| | Направление | Что делаю |
|---|-------------|-----------|
| 🔍 | **Проверка (С‑02)** | Опечатки, грамматика, стиль — одна таблица «Ошибка → Правильно» |
| 📝 | **Создание (С‑01)** | Письма, объявления, фрагменты договоров, отчёты по правилам вида |
| 🔁 | **Правка и стиль** | Перепись: Йода, выжимка, официально, научно, публицистически, художественно, разговорно |
| 📎 | **Открытый документ** | Вставка / исправления в R7 Word через плагин после вашего согласия |

Также: краткое **саммари**, **комментарий** рецензента, ответ на вопросы по каталогу правил и стилей.

**Результат:** черновик или замечания в чате → изменения в документе после **«исправь» / «вставь»** или кнопки плагина.

[Как работать](${HELP_HOWTO_HASH})
`;

export const HELP_HOWTO_MD_LCA = `# Как работать с «Лингвистическая проверка текстов»

## ⏱️ Главное за 15 секунд

| № | Что происходит |
|---|----------------|
| 1️⃣ | Вы пишете **цель** (проверить / создать / переписать) и при необходимости **вид документа** |
| 2️⃣ | Я готовлю результат в чате: **таблицу замечаний** или **полный черновик** |
| 3️⃣ | Документ **не меняю**, пока вы не подтвердите |
| 4️⃣ | Напишите **«исправь все»** / **«вставь»** или нажмите кнопку в панели плагина |

## 🗂️ Режимы работы

| Режим | Когда | Результат |
|-------|--------|-----------|
| **Рекомендации** | «проверь», без «исправь» | Таблица замечаний (№, Ошибка, Правильно) + согласие |
| **Правка опечаток** | «исправь все» / «исправь 1, 3» | Плагин применяет замены в документ |
| **Создание / перепись** | «напиши», «перепиши», «как Йода», «краткая выжимка» | Черновик в чате → вставка после «вставь» |
| **Саммари** | «сделай саммари» (без «вставь») | Краткое содержание в чате |

**Порядок:** сначала смотрите ответ в чате → потом подтверждаете. Иначе документ не должен меняться.

## 📚 Какие правила и стили есть

Спросите: «какие есть правила и стили?» / «какие форматы оформления?»

**Форматы документов**

| Формат | Как попросить |
|--------|---------------|
| **Нейтральный текст** | «нейтрально», вид не указан |
| **Деловое письмо / служебная записка** | письмо, служебная записка |
| **Договор / соглашение** | договор, соглашение, оферта |
| **Объявление / анонс** | объявление, анонс, пост |
| **Служебный отчёт** | отчёт, итоги |

**Стили переписки**

| Стиль | Как попросить |
|-------|---------------|
| **Стиль Йоды** | «как Йода» |
| **Краткая выжимка** | «краткая выжимка», «для руководства», «в тезисах» |
| **Официально-деловой** | «официально», «канцелярский» |
| **Научный** | «научно», «академический» |
| **Публицистический** | «публицистически», «как в СМИ», «для блога» |
| **Художественный** | «художественно», «образно» |
| **Разговорный** | «разговорно», «неформально», «для чата» |

Формат = вид документа; стиль = тон переписи. Если не уверены — укажите одной фразой.

## 🎛️ Кнопки плагина (после ответа)

| | Кнопка | Что делает |
|---|--------|------------|
| ✓ | **Все** | Исправить все пары из таблицы замечаний |
| ↖ | **Курсор** | Вставить черновик у курсора |
| ⇄ | **Заменить** | Заменить выделенный фрагмент |
| ↓ | **Конец** | Вставить в конец документа |
| 💬 | **Коммент** | Добавить комментарий рецензента |
| ⇩ | **MD** / **HTML** | Скачать черновик |

Вместо кнопок можно писать: \`исправь все\`, \`исправь 1, 3\`, \`вставь\`, \`замени выделенное\`, \`да\`.

## ✅ Согласование перед вставкой

Даже если в запросе «сгенерируй и вставь» — сначала черновик в чате.  
В документ текст попадает **только** после явного согласия (фраза или кнопка).

## ✍️ Как формулировать запрос

**Цель + вид документа (если нужен) + куда результат**

Примеры:

- \`Проверь текст на опечатки. Вид документа: договор\`
- \`Проверь стиль служебной записки. Только рекомендации в чате\`
- \`Напиши деловое письмо поставщику про задержку. Только в чат\`
- \`Составь объявление о собрании 20 июля в 15:00. Вставь у курсора\`
- \`Перепиши выделенный фрагмент как Йода\`
- \`Перепиши выделенное: краткая выжимка / в тезисах для совещания\`
- \`Перепиши официально\` / \`научно\` / \`публицистически\` / \`художественно\` / \`разговорно\`
- \`Сделай краткое саммари документа\`

## ❓ Если что-то неясно

Коротко уточните: весь документ или выделение, какой вид, только рекомендации или сразу правка — и продолжим.

Если документ «не виден» агенту — нажмите **«Синхр. документ»** или откройте новый чат.`;

/** @deprecated aliases — prefer profile-aware helpers */
export const HELP_CAPABILITIES_MD = HELP_CAPABILITIES_MD_SPREADSHEET;
export const HELP_HOWTO_MD = HELP_HOWTO_MD_SPREADSHEET;

export function isLcaAgent(agentId?: string, agentLabel?: string): boolean {
  const id = String(agentId || "").trim();
  if (id && id === LCA_AGENT_ID) return true;
  const label = String(agentLabel || "").toLowerCase();
  if (!label) return false;
  return (
    /\blca\b/.test(label) ||
    /лингвист/.test(label) ||
    /проверк\w*\s+текст/.test(label)
  );
}

export function isSpreadsheetHelpAgent(agentId?: string, agentLabel?: string): boolean {
  const id = String(agentId || "").trim();
  if (id && id === SPREADSHEET_AGENT_ID) return true;
  const label = String(agentLabel || "").toLowerCase();
  if (!label) return false;
  return (
    /работ\w*\s+с\s+таблиц/.test(label) ||
    /excel/.test(label) ||
    /сводн/.test(label)
  );
}

/**
 * Which offline FAQ pack to show. null = no local start/FAQ pack for this agent.
 */
export function resolveLocalHelpProfile(options: {
  contextFamily?: string;
  agentId?: string;
  agentLabel?: string;
}): LocalHelpProfile | null {
  // Agent identity wins over editor family (LCA must not get spreadsheet FAQ in Cell).
  if (isLcaAgent(options.agentId, options.agentLabel)) return "lca";
  if (isSpreadsheetHelpAgent(options.agentId, options.agentLabel)) return "spreadsheet";
  const family = String(options.contextFamily || "");
  if (family === "spreadsheet") return "spreadsheet";
  return null;
}

export function helpStartMarkdown(profile: LocalHelpProfile): string {
  return profile === "lca" ? HELP_START_MD_LCA : HELP_START_MD_SPREADSHEET;
}

export function localHelpMarkdown(
  kind: LocalHelpKind,
  profile: LocalHelpProfile = "spreadsheet",
): string {
  if (profile === "lca") {
    return kind === "howto" ? HELP_HOWTO_MD_LCA : HELP_CAPABILITIES_MD_LCA;
  }
  return kind === "howto" ? HELP_HOWTO_MD_SPREADSHEET : HELP_CAPABILITIES_MD_SPREADSHEET;
}

/** Strip R7 workbook/document context block appended by the plugin. */
export function stripR7ContextForHelp(raw: string): string {
  return String(raw || "")
    .replace(/\n*---\s*\n\[Контекст R7:[\s\S]*$/i, "")
    .trim();
}

/** Normalize FAQ phrase: drop noise punctuation, keep words. */
function normalizeHelpPhrase(raw: string): string {
  return stripR7ContextForHelp(raw)
    .toLowerCase()
    .replace(/[*_~`]+/g, "")
    .replace(/[?!.,;:…]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Concrete task → leave for agent (even if "умеешь" appears). */
function looksLikeConcreteTask(compact: string, profile: LocalHelpProfile): boolean {
  // JS \b is ASCII-only — never use it with Cyrillic.
  if (profile === "lca") {
    return /(^|[^а-яёa-z0-9_])(проверь|проверк|исправ|замени|перепиши|сгенерируй|создай|напиши|саммари|вставь|опечат|комментар|договор|письм|стилист|орфограф|граммат|пунктуац|речев|логик|поправи)/i.test(
      compact,
    );
  }
  return /(^|[^а-яёa-z0-9_])(сводн|фильтр|сортир|дубликат|kpi|топ-?\s*\d|выдели|закрась|оформи|посчитай|построй|сделай|оставь|раздвинь|вставь|замени)/i.test(
    compact,
  );
}

function isHowtoFaq(compact: string, profile: LocalHelpProfile): boolean {
  if (looksLikeConcreteTask(compact, profile)) return false;
  return (
    /как\s+работ/.test(compact) ||
    /как\s+польз/.test(compact) ||
    /как\s+встав/.test(compact) ||
    /что\s+нажим/.test(compact) ||
    /как\s+нажим/.test(compact) ||
    /^справк/.test(compact) ||
    /^инструкц/.test(compact) ||
    /how\s*to/.test(compact) ||
    /^(help|хелп|помощь)$/.test(compact) ||
    (/кнопк/.test(compact) && /(плагин|что|как|какие)/.test(compact))
  );
}

function isCapabilitiesFaq(compact: string, profile: LocalHelpProfile): boolean {
  if (!compact) return false;
  // Any concrete edit/check request → agent (not offline FAQ).
  if (looksLikeConcreteTask(compact, profile)) return false;
  // Long / task-shaped → agent
  if (compact.length > 72) return false;

  // Full / near-full FAQ lines (incl. missing «?» and trailing junk)
  if (/^(что\s+)?(ты\s+)?(умеешь|можешь)(\s+делать)?$/.test(compact)) {
    return true;
  }

  // Truncated start: «о ты умеешь», «то ты умеешь», «чт ты умеешь», «чо ты умеешь»
  if (/^(о|то|чт|чо|што)\s+ты\s+(умеешь|можешь)$/.test(compact)) return true;

  // Core meta phrases — require «ты умеешь/можешь», not «что можно поправить».
  if (
    /ты\s+умеешь/.test(compact) ||
    /ты\s+можешь/.test(compact) ||
    /^умеешь(\s+делать)?$/.test(compact) ||
    /^можешь(\s+делать)?$/.test(compact) ||
    /что\s+ты\s+уме/.test(compact) ||
    /что\s+ты\s+можн/.test(compact) ||
    /что\s+ты\s+дела/.test(compact) ||
    /^что\s+умеешь/.test(compact) ||
    /^что\s+можешь(\s+делать)?$/.test(compact) ||
    /какие?\s+(у\s+тебя\s+)?(есть\s+)?возможност/.test(compact) ||
    /как(ие|ой)?\s+возможност/.test(compact) ||
    /твой?\s+функционал/.test(compact) ||
    /^функционал$/.test(compact) ||
    /для\s+чего\s+ты/.test(compact) ||
    /расскажи\s+(о\s+себе|что\s+уме)/.test(compact) ||
    /what\s+can\s+you\s+do/.test(compact) ||
    /your\s+capabilities/.test(compact)
  ) {
    return true;
  }

  return false;
}

export function detectLocalHelpIntent(
  userText: string,
  profile: LocalHelpProfile = "spreadsheet",
): LocalHelpKind | null {
  const compact = normalizeHelpPhrase(userText);
  if (!compact) return null;

  if (isHowtoFaq(compact, profile)) return "howto";
  if (isCapabilitiesFaq(compact, profile)) return "capabilities";
  return null;
}

export function isHelpCapabilitiesHash(
  href: string | null | undefined,
): boolean {
  const h = String(href || "").trim();
  return (
    h === HELP_CAPABILITIES_HASH ||
    h === "r7-help-capabilities" ||
    h.endsWith(HELP_CAPABILITIES_HASH)
  );
}

export function isHelpHowtoHash(href: string | null | undefined): boolean {
  const h = String(href || "").trim();
  return (
    h === HELP_HOWTO_HASH ||
    h === "r7-help-howto" ||
    h.endsWith(HELP_HOWTO_HASH)
  );
}

export function detectLocalHelpKindFromHash(
  href: string | null | undefined,
): LocalHelpKind | null {
  if (isHelpHowtoHash(href)) return "howto";
  if (isHelpCapabilitiesHash(href)) return "capabilities";
  return null;
}
