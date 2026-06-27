# Кейс: агент сравнения документов

Prod-агент: **`mwCvjRFNfMsFInbLjrrdr`** («Агент сравнения документов»). Навык: **`doc_compare_toolkit`**.

Демонстрационный сценарий: плагин загружает документ в `/session/`, агент подтверждает получение,
показывает шаблоны из `/workspace/Templates/`, сравнивает с выбранным шаблоном и выдаёт отчёт,
затем предлагает вставить отчёт в документ или скачать файл.

## Состав

```
doc_compare/
  doc_compare_toolkit/     навык: 6 tools (в т.ч. resolve_r7_document)
  doc_compare_agent/       агент (instruction.md)
  docs/                    контракт данных R7-плагина
    r7-plugin-data-contract.md
  workspace/               файлы для загрузки в /workspace агента
    Templates/             шаблоны для list_templates
    temp.md                отчёт сравнения (возвращается compare_with_template)
  inputs/                  пример документа для загрузки в /session
    sample_document.md
```

## Сценарий

1. Плагин загружает `inputs/sample_document.md` в `/session/`.
2. Пользователь открывает чат — агент подтверждает документ, представляется, выводит список шаблонов.
3. Пользователь выбирает шаблон — агент сообщает о начале сравнения, вызывает `compare_with_template`.
4. Агент выводит markdown-отчёт в чат.
5. Агент спрашивает: вставить в документ или скачать — по выбору вызывает `insert_report_into_document`
   или `save_report_for_download`.

## Интеграция R7 (ladcraft-r7)

**Контракт данных плагина (для следующих агентов):** [docs/r7-plugin-data-contract.md](docs/r7-plugin-data-contract.md)  
Cursor-правило: `.cursor/rules/ladcraft-r7-plugin-transfer.mdc`

- Документ B: `/session/r7/r7-*.json` (`r7-snapshot/v1`), upload плагином.
- Поиск snapshot: `resolve_r7_document` (retry); чтение — `bash head`.

Сборка payload для prod:

```bash
cd cases/doc_compare && npm install && node build_payload.js
```
