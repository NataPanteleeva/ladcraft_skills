# Excel Pivot + плагин R7 (ladcraft-r7_new)

Контракт для агента `Excel Pivot Report` (`UsL7iqdQLBtYpmP0s7dWF`) при работе из **R7 Cell**.

Канон потоков: [`DATA-FLOW-CANON.md`](../../plugin/ladcraft-r7_new/docs/DATA-FLOW-CANON.md) §1.3, §2.2 (outbound), **§2.3**, **§3**, **§7.1**.

## Что отдаёт плагин

| Поле | Значение |
|------|----------|
| VFS file (`mentioned.files`) | **Только** открытая книга `/session/r7/{sessionSeg}/r7-….xlsx` |
| Supplement | `[Контекст R7: workbook]` + `workbook_path:`; `last_result_path:` **только** refine |
| Результат analytics (`*_filter.xlsx`, `top_*.xlsx`) | **Не** в `mentioned.files`. Только session VFS + строка `Файл:` + кнопки |

Не использовать JSON `r7-snapshot` как источник таблиц. Прошлый `Файл:` не default-источник следующего хода.

## Multi-turn

Каждый новый текст = новый Intent. Доуточнения и следующие задачи — норма.

- Плагин перед follow-up: `ensureAgentQueueIdleBeforeSend`; orphan-retry ~16 с (`0.6.59+`).
- После `stop`/`userReply` — ноль tools.
- Meta / вопрос про прошлый ответ — **без** toolkit (лёгкий чат).
- `lca-chat` / `r7-chat` для Cell-уточнений **не** активировать.

## Источник

- Default: `workbook_path` (открытая книга), не прошлый result.
- `last_result_path` — только «доработай сводную / по KPI / этот результат».
- Несколько листов → `pick_working_source` → вопрос `options`, без других tools.

## Intent → действие

| Intent | Действие |
|--------|----------|
| Сорт / фильтр / KPI / сводная / шапка | `excel_pivot_toolkit` (happy-path без `vfs_file_capabilities`) |
| Какую аналитику / неясный scope («разбей по городам») | **сначала** 1 короткий вопрос, **без** tools |
| Meta про прошлый ответ («это по всем городам?») | 1–3 предложения, **без** activate/tools |
| Замени лист / новый лист / вставь | плагин alone |

**Запрещено:** host `bash`/`python`/`vfs_file_capabilities`/`readFile`; `sheet_replace`; писать в `/session/r7/`; передавать `targetPath`.

## Ответ

1. Analytics tool → `ok`/`stop`/`userReply` → ответ = **только** `userReply` (внутри есть `Файл:`).
2. Вставка в Cell — кнопки **XLSX / Лист / Вставить / Заменить / CSV** или фразы «на новый лист» / «замени текущую таблицу».
3. После `cell_format` — короткий итог **без** фраз про кнопки файла.
4. Clarify — короткий текст, без `Файл:` и без tools.

## Smoke

1. Analytics → `Файл:` + кнопки; следующий user-content **без** `last_result_path` (пока нет refine).
2. Follow-up sort / top-N → не orphan.
3. После топ-N: «это по всем городам?» → короткий ответ **без** tools (headless 2026-07-24: session `v38mWoEl9egbKlIXkUpXq` — после abort/retry: «по всем городам…»).
4. Плагин ≥ `0.6.60-requires-action`: abort `requires_user_action` + orphan-retry.

## Ограничения плагина

Export из Cell может обрезать большие диапазоны. При сомнении — полный `.xlsx` в session.
