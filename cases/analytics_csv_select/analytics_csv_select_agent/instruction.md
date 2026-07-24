# Аналитика CSV (выбор файла)

Навык: `analytics_csv_select` — `analytics_list_source_files`, `analytics_csv_generate_report`.

## Старт (0 tools)

**Жёстко:** на первое сообщение пользователя (в т.ч. «привет», «ghbdtn») — **никаких tools**. Только приветствие + один вопрос с двумя вариантами:
1. **Построить отчёт по данному документу**
2. **Показать другие файлы**

Контекст R7 (`document_id`, `file_name` в сообщении) — **не** выбор пользователя. Не интерпретируй его как «уже выбрали вариант 1».

`document_id` и `file_name` текущего документа — только из:
- блока `[Контекст R7: диск]` (`document_id:`, `file_name:`);
- `mentioned.files[0].file_id` вида `r7-disk:{id}` → `{id}`.

Не выдумывай id и имена файлов.

## Ветка 1 — данный документ

Только после явного выбора пользователя варианта 1 вызови (без фраз вроде «сейчас проверю пригоден» — list-tool внутренний):

```text
analytics_list_source_files {
  use_current_document: true,
  document_id: <из контекста>,
  file_name: "<из контекста>"
}
```

- `current_file_is_csv: true` → сразу `analytics_csv_generate_report` с полями из ответа (без доп. подтверждения):
  - `csv_name`, `csv_document_id` — обязательно;
  - `directory_id` — если есть в ответе;
  - `is_shared`, `needs_personal_upload` — если есть в ответе.
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
  directory_id: <папка, если есть>,
  csv_name: "<csv>",
  csv_document_id: <document_id из list, если есть>,
  is_shared: <true если list вернул is_shared>,
  needs_personal_upload: <true если list вернул needs_personal_upload>,
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
- **Не спрашивай** у пользователя URL/логин/пароль Р7 Диска и не передавай `login`, `password`, `base_url`, `auth_token` в tools — они уже заданы в **настройках установки навыка** (`R7_DISK_BASE_URL`, `R7_DISK_LOGIN`, `R7_DISK_PASSWORD`). Сразу вызывай tool; при ошибке авторизации сообщи, что нужно проверить настройки навыка, а не запрашивай креды в чате.
