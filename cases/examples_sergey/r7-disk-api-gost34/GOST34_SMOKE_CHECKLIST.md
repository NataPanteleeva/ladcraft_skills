# GOST34 Smoke Checklist (r7-disk-api)

## Технический smoke (локально)

- [x] `node --check scripts/r7_disk_gost34_generate.js`
- [x] `node --check scripts/r7_disk_document.js`
- [x] Проверка lints для изменённых файлов (ошибок нет)

## E2E smoke на стенде Р7 Диск

Перед прогоном:
- Настроить `R7_DISK_BASE_URL`, `R7_DISK_LOGIN`, `R7_DISK_PASSWORD`.
- Подготовить папки:
  - templates (с `gost34_task_description_template.docx`)
  - results
  - input (с тестовыми входными файлами)

### Сценарий 1: Базовый успешный прогон

Вызов `r7_disk_gost34_generate`:
- `input_directory_id`: `<input_dir_id>`
- `input_name`: `task_input.docx`
- `template_directory_id`: `<templates_dir_id>`
- `template_name`: `gost34_task_description_template.docx`
- `result_directory_id`: `<results_dir_id>`

Ожидание:
- `ok: true`
- в `results` создан `task_input_gost34_postanovka.docx`
- заполнены `filledSlots/missingSlots`, есть `recommendations` при неполном контенте.

### Сценарий 2: Шаблон отсутствует

Вызов с несуществующим `template_name`.

Ожидание:
- `ok: false`
- ошибка про отсутствие шаблона в папке templates.

### Сценарий 3: Нет прав на папку результатов

Вызов с `result_directory_id`, где нет прав записи.

Ожидание:
- `ok: false`
- ошибка upload/доступа без утечки секретов.

### Сценарий 4: Конфликт имени результата

Повторный вызов с тем же `output_name`.

Ожидание:
- при `conflict_policy: suffix` создаётся файл с timestamp-суффиксом;
- при `conflict_policy: error` возвращается контролируемая ошибка;
- при `conflict_policy: overwrite` старый файл заменяется.

## Publish/install checklist

1. Убедиться, что есть `scripts/r7_disk_gost34_generate.js` и `scripts/r7_disk_gost34_generate.meta.md`.
2. Убедиться, что `SKILL.md` содержит tool `r7_disk_gost34_generate` во frontmatter.
3. Проверить network hosts в meta нового tool под целевой стенд.
4. Проверить env-поля:
   - `R7_DISK_GOST34_TEMPLATE_DIRECTORY_ID`
   - `R7_DISK_GOST34_TEMPLATE_NAME`
   - `R7_DISK_GOST34_RESULT_DIRECTORY_ID`
5. После publish выполнить Сценарий 1 как обязательный smoke.
