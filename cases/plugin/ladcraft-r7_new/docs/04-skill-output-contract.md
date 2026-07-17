# Контракт вывода навыка (ladcraft-r7_new / LCA)

## Primary для однократной вставки / замены выделения

Плагин применяет **intent** пользователя («вставь», «да», «в конец», …) к последнему черновику в чате  
(`src/apply/intent-apply.ts`) — **без** ожидания tool_call навыка.

Агент на этих фразах: краткий ack, **без** write-tools.

## tool_calls (пакетные правки + fallback)

| Сценарий | Канал |
|----------|--------|
| `search_replace` × N, `cell_paste` (карта) | **tool_calls** обязательны |
| paste / replace_selection / add_comment | intent плагина; tools — fallback |

Handler stub возвращает payload для `buildTask` / `TOOL_NAME_TO_TYPE` (`src/apply/tool-call-parser.ts`).

Пример: `r7_search_replace` → `{ ok, search, replace, matchCase, data: { search, replace, matchCase } }`.

## User-facing текст

- Краткий итог **без** служебного JSON.
- Fence ```r7.task``` — только fallback.
- Не дублировать полный tool JSON в чат.

## После apply: `r7.event`

Плагин шлёт:

```r7.event
{
  "schema": "r7.event/v1",
  "kind": "apply_result",
  "applied": 1,
  "failed": 0,
  "errors": [],
  "tasks": [{ "type": "search_replace", "data": { "search": "…", "replace": "…" } }]
}
```

Агент / навык: не re-apply; при ошибках — другой план.

## Оформление

- Plain find/replace → `r7_search_replace`.
- HTML / оформление выделения → плагин `replace_selection` / `paste` (не CharacterFormat API).

## Слой кнопок (наследие)

Intent-gated insert/download и `r7.actions` остаются как в btn_stream; для LCA основной продуктовый путь — auto-apply tools + event loop.

Агент: [`cases/LCA/`](../../LCA/).
