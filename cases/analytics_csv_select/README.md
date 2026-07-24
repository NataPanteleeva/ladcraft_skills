# Кейс: аналитика продаж CSV с выбором файла на Р7 Диске

Новый кейс на базе `analytics_csv`: пользователь сначала выбирает CSV на диске, затем агент формирует `отчет_продаж.xlsx` в той же папке.

## Состав

```
analytics_csv_select/
  analytics_csv_select/          навык (2 инструмента)
  analytics_csv_select_agent/    агент (instruction.md)
  build-skill-payload.py         сборка payload для publish
  publish-skill.js               полный цикл: publish + sync кредов + bind агента
  sync-after-reconnect.js        после reconnect в UI: skill-config + bind
  install.defaults.json.example  шаблон R7_DISK_* (без секретов)
  install.defaults.json          локальные креды для publish/sync (в .gitignore)
  lib/sync-install.js            общая логика sync
```

## Демо / переподключение

Ladcraft хранит `R7_DISK_*` в **установленной копии** навыка, а не в каталоге «Созданные». После disconnect/reconnect появляется новый `installed_application_id` — старый `skill-config` перестаёт действовать.

**Три слоя защиты:**

1. **Publish fallback** — при `publish-skill.js` креды из `install.defaults.json` вшиваются в код навыка (JS + Python). Демо работает даже без `skill-config` на новой установке.
2. **sync-after-reconnect** — одна команда после reconnect в UI переносит креды и привязывает агента к актуальному `installed.id`.
3. **Fail-fast** — `analytics_list_source_files` не возвращает ложный `ok: true` без кредов (вместо degraded path по имени `.csv`).

### Чеклист

1. Скопируйте `install.defaults.json.example` → `install.defaults.json`, заполните `R7_DISK_*`.
2. Полный цикл (новая версия на prod + sync):

   ```bash
   node cases/analytics_csv_select/publish-skill.js
   ```

3. Если только переподключили навык в UI:

   ```bash
   node cases/analytics_csv_select/sync-after-reconnect.js
   ```

4. Новый чат с агентом «Аналитика продаж CSV (выбор файла)» (`MOVc1GIygOzS9kwKHyo04`).

## Логика

1. `analytics_list_source_files` — document-id-first для текущего документа; для других файлов находит папку `Таблицы для отчета` или список папок под `Мои документы`.
2. `analytics_csv_generate_report` — читает CSV, строит XLSX `отчет_продаж.xlsx` in-place в той же папке.

## Smoke-checklist

### A — текущий CSV (document-id-first)
- [ ] Открыть `.csv` в R7, выбрать «по данному документу».
- [ ] `analytics_list_source_files` → `current_file_is_csv: true`, `csv_document_id`, `csv_name`; `directory_id` если найдена папка.
- [ ] Агент сразу вызывает `analytics_csv_generate_report` с `csv_document_id` → `отчет_продаж.xlsx`.

### B — текущий не-CSV
- [ ] Открыть `.docx` в R7, выбрать «по данному документу».
- [ ] `current_file_is_csv: false`, `fallback_to_other_files: true`.
- [ ] Агент переходит к поиску папки/списку CSV (ветка «другие файлы»).

### C — другие файлы
- [ ] Выбрать «показать другие файлы».
- [ ] `analytics_list_source_files` находит `Таблицы для отчета` или возвращает `folders`.
- [ ] После выбора CSV и команды — `analytics_csv_generate_report` сохраняет отчёт in-place.
