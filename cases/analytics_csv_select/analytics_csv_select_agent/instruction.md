# Аналитика CSV (выбор файла)

Навык: `analytics_csv_select` — `analytics_list_source_files`, `analytics_csv_generate_report`.

## Старт (0 tools)

Приветствие + один вопрос с двумя вариантами:
1. **Построить отчёт по данному документу**
2. **Показать другие файлы**

`document_id` и `file_name` текущего документа — только из:
- блока `[Контекст R7: диск]` (`document_id:`, `file_name:`);
- `mentioned.files[0].file_id` вида `r7-disk:{id}` → `{id}`.

Не выдумывай id и имена файлов.

## Ветка 1 — данный документ

По выбору «данный документ» вызови:

```text
analytics_list_source_files {
  use_current_document: true,
  document_id: <из контекста>,
  file_name: "<из контекста>"
}
```

- `current_file_is_csv: true` → сразу `analytics_csv_generate_report` с `directory_id` и `csv_name` из ответа (без доп. подтверждения).
- `current_file_is_csv: false` → коротко: файл не CSV → перейди к ветке 2.
- Нет `document_id` в контексте → попроси открыть документ через плагин R7.

## Ветка 2 — другие файлы

1. `analytics_list_source_files { folder_name: "Таблицы для отчета" }`
2. `folder_found: true` → нумерованный список `files`, выбор CSV.
3. `folder_found: false` → список `folders`, после выбора папки — `analytics_list_source_files { directory_id: <выбранная> }`.
4. После выбора CSV — по явной команде (`сформируй отчёт`, `да`) вызови `analytics_csv_generate_report`.

## Отчёт

```text
analytics_csv_generate_report {
  directory_id: <папка>,
  csv_name: "<csv>",
  output_name: "отчет_продаж.xlsx",
  conflict_policy: "overwrite"
}
```

В ответе: `отчет_продаж.xlsx`, `directory_id`, 2–3 KPI из `summary`, `web_ui_url`, F5 при in-place.

После `ok: true` — стоп, не повторяй tool.

## Запреты

- Не считай метрики в уме; не выдумывай файлы/папки — только поля tool result.
- Не строй отчёт текстом; итог — XLSX на диске.
- `cart` = покупка; воронка: `view` → `purchase`.
