# Кейс: аналитика продаж CSV → XLSX на Р7 Диск

Навык `analytics_csv` и агент `analytics_csv_agent` анализируют CSV с событиями продаж на Р7 Диск и создают XLSX-отчёт в той же папке.

## Состав

```
analytics_csv/
  analytics_csv/              навык (tool analytics_csv_generate_report)
  analytics_csv_agent/        агент (instruction.md)
  data_first_1000.csv         локальная фикстура для dev-тестов
  scripts/                    dev-скрипты (шаблон XLSX, embed base64)
  build-skill-payload.py      сборка payload для publish
```

## Бизнес-правила

- **Покупки** (сводка, бренды, категории, динамика): `event_type = cart`
- **Воронка**: `view` → `purchase`

## Локальный тест аналитики

```bash
cd cases/analytics_csv
node scripts/test_analytics_local.mjs
```

## Сборка payload

```bash
python build-skill-payload.py
```

## Smoke-checklist

- [ ] CSV скачивается из папки 109
- [ ] XLSX создаётся в той же папке как `отчет_продаж.xlsx`
- [ ] 5 листов: Сводка, Бренды, Категории, Воронка, Динамика
- [ ] На каждом листе таблица и график
- [ ] Повторный запуск перезаписывает `отчет_продаж.xlsx` (overwrite)

## Publish

См. `.cursor/skills/ladcraft-prod-publish/SKILL.md` — опубликовать навык и агента, привязать навык, задать `R7_DISK_*` и `ANALYTICS_CSV_DIRECTORY_ID=109` через `skill-config`.

**Prod IDs (2026-06-29):**
- Skill app: `P8eMU4QQqDrQowycrf0Jj`
- Agent: `VcMnEPee68yRnnZ4qH1gS` (title: **Аналитика продаж CSV**)
- Installed skill: `11CVZSP4JnJhdeUe6umTH`
