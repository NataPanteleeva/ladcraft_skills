# Кейс: табличная аналитика Excel (pivot + расширения)

Агент + навык читают `.xlsx` (UI Ladcraft или плагин R7 Cell) и пишут результат в **отдельный файл** session VFS.

Плагин R7: [docs/PLUGIN-R7.md](docs/PLUGIN-R7.md).

## Состав

```
excel_pivot_report/
  excel_pivot_toolkit/     навык v1.11.0
  excel_pivot_agent/       instruction.md
  docs/PLUGIN-R7.md
  inputs/                  тестовые .xlsx
```

## Возможности (v1.10)

| Группа | Tools |
|--------|--------|
| Источник | `pick_working_source`, `list_workbooks`, `inspect_workbook` |
| База | `build_pivot_table` |
| Качество | `profile_sheet`, `dedupe_rows` |
| Нарезка | `filter_export`, `select_columns`, `sort_rows` |
| Расчёты | `add_calculated_column`, `time_bucket`, `top_n_summary` |
| Сверка листов | `compare_sheets` (`diff` / `join` / `reconcile`) |

Сверка **двух файлов с Р7-Диска** — отдельный server-агент (Phase 2, disk-ref), не этот кейс.

## Поток

1. Источник = `workbook_path` (или `pick_working_source`).
2. Intent → один analytics tool (см. `docs/PLUGIN-R7.md` / DATA-FLOW §2.3).
3. Result `userReply` / `Файл: /session/….xlsx` → стоп.

## Runtime

- `python@3` + `openpyxl`
- Skill version: **1.10.0**

## Prod (этот аккаунт)

| Сущность | Id |
| --- | --- |
| Skill `excel_pivot_toolkit` | `dCBtc5mdPQV846hIqW0Hp` |
| Installed skill | `bhybFmo3f_4kQibmCE4PV` |
| Agent `Excel Pivot Report` | `UsL7iqdQLBtYpmP0s7dWF` |
| Binding | `KFl4wM1JuudRzf878wfDc` |
| Model | `qwen3.5-35B` (`X2GyKB3eVGDc3sY6jZZVr`) |

Disk-агент (тот же функционал без VFS): см. [`../excel_table_disk/`](../excel_table_disk/).

## Тестовые файлы

| Файл | Лист | Колонки (ориентир) |
| --- | --- | --- |
| `Продажи_1000.xlsx` | Продажи | Дата, Регион, Менеджер, Категория, Товар, Количество, Цена, Сумма |
| `Проекты_800.xlsx` | Sheet | Проект, Клиент, Руководитель, Статус, Бюджет, Факт, Приоритет |
| `Сотрудники_500.xlsx` | Sheet | Сотрудник, Отдел, Город, Возраст, Стаж, Оклад, Премия |
