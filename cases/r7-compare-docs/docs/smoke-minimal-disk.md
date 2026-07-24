# Smoke: minimal disk client data

Проверяет контракт «клиент заполняет минимум»:

1. Install навыков — только `R7_DISK_BASE_URL`, `R7_DISK_LOGIN`, `R7_DISK_PASSWORD`
2. Папка `templates` в «Мои документы» — находится навыком, **не** из env и **не** из supplement
3. `r7_list_disk_templates` — авто-поиск `templates`, кэш `CompareResults`
4. `r7_save_compare_report_to_disk` — корень из skillStorage, без probe id

## Локальный dry-run (без prod)

```bash
node cases/r7-compare-docs/smoke_minimal_disk.js --check-contract
```

## E2E (нужны креды; опционально host document id)

```bash
set R7_DISK_BASE_URL=https://cddisk.example.ru
set R7_DISK_LOGIN=user
set R7_DISK_PASSWORD=secret
set R7_HOST_DOCUMENT_ID=12345
node cases/r7-compare-docs/smoke_minimal_disk.js
```

`R7_HOST_DOCUMENT_ID` помогает определить «Мои документы» через `Documents/Get`; без него навык пробует login User и стандартный probe.

## Ожидания

| Шаг | OK |
|-----|-----|
| `r7_list_disk_templates({ host_document_id })` | `ok`, `templates[]`, `my_documents_directory_id` |
| skillStorage после START | `r7_disk_templates_directory_id`, `r7_disk_compare_results_folder_id` |
| Env без `R7_COMPARE_TEMPLATES_DIRECTORY_ID` | навык стартует |
