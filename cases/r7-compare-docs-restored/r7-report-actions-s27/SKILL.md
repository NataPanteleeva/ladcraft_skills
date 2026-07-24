---
name: r7-report-actions-s27
description: r7.task и виджет действий для отчёта сравнения r7-compare-docs.
version: 6.0.1
mcp_spec:
  tools:
    - name: r7_prepare_report_actions
    - name: r7_show_compare_actions_widget
---

Навык подготавливает действия плагина `ladcraft-r7` для готового markdown-отчёта.

## Tools

### `r7_show_compare_actions_widget`

Вызывай **сразу после финального отчёта сравнения** (в том же turn, после текста отчёта и подсказок). Параметры не нужны. Возвращает виджет с кнопками:

- Вставить в конец документа → `вставить`
- Скачать md → `скачать md`
- Скачать html → `скачать html`
- Сохранить на Р7-диск → `сохранить на диск`

### `r7_prepare_report_actions`

Только **после клика** по виджету или явного текста пользователя.

`r7_prepare_report_actions({ markdown, mode, fileName? })`

- `mode: "insert"` — вставка в документ;
- `mode: "download_md"` — скачивание `.md`;
- `mode: "download_html"` — скачивание `.html` для Word;
- `mode: "both"` — вставка + `.md`.

Ответ: короткий текст + `r7_task_block` **без изменений** (кроме save-to-disk flow — там без r7.task).
