# Кейс: аналитика продаж CSV с выбором файла на Р7 Диске

Новый кейс на базе `analytics_csv`: пользователь сначала выбирает CSV на диске, затем агент формирует `отчет_продаж.xlsx` в той же папке.

## Состав

```
analytics_csv_select/
  analytics_csv_select/          навык (2 инструмента)
  analytics_csv_select_agent/    агент (instruction.md)
  build-skill-payload.py         сборка payload для publish
```

## Логика

1. Старт: выбор «по данному документу» или «другие файлы».
2. **Данный документ:** `analytics_list_source_files` с `use_current_document: true` → если CSV, сразу отчёт; иначе fallback к п.3.
3. **Другие файлы:** поиск папки `Таблицы для отчета`, список CSV или fallback-список папок.
4. После выбора CSV (ветка «другие файлы») — `analytics_csv_generate_report` по явной команде.

## Smoke-checklist

### A — текущий CSV
- [ ] Открыть `.csv` в R7, выбрать «по данному документу».
- [ ] `analytics_list_source_files` → `current_file_is_csv: true`, `directory_id`, `csv_name`.
- [ ] Агент сразу вызывает `analytics_csv_generate_report` → `отчет_продаж.xlsx`.

### B — текущий не-CSV
- [ ] Открыть `.docx` в R7, выбрать «по данному документу».
- [ ] `current_file_is_csv: false`, `fallback_to_other_files: true`.
- [ ] Агент переходит к поиску папки/списку CSV (ветка «другие файлы»).

### C — другие файлы
- [ ] Выбрать «показать другие файлы».
- [ ] `analytics_list_source_files` находит `Таблицы для отчета` или возвращает `folders`.
- [ ] После выбора CSV и команды — `analytics_csv_generate_report` сохраняет отчёт in-place.
