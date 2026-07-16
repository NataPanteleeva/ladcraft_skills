# Контракт вывода навыка (ladcraft-r7_new / LCA)

## Primary: tool_calls

Навык вызывает объявленный tool (`r7_paste`, `r7_paste_text`, `r7_replace_selection`, `r7_search_replace`, `r7_add_comment`, `r7_cell_paste`).  
Плагин читает `history.tool_calls` и auto-apply editor types.

Handler возвращает payload, совместимый с `buildTask` / `TOOL_NAME_TO_TYPE` (см. `src/apply/tool-call-parser.ts`).

Пример: `r7_search_replace` → `{ ok, search, replace, matchCase, data: { search, replace, matchCase } }`.

## User-facing текст

- Краткий итог для пользователя **без** служебного JSON.
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

Агент / навык: не re-apply те же задачи; при ошибках — другой план.

## Оформление

- Plain find/replace → `r7_search_replace`.
- HTML / оформление выделения → `r7_replace_selection` или `r7_paste` (не CharacterFormat API).

## Слой кнопок (наследие)

Intent-gated insert/download и `r7.actions` остаются как в btn_stream; для LCA основной продуктовый путь — auto-apply tools + event loop.

Агент: [`cases/LCA/`](../../LCA/).
