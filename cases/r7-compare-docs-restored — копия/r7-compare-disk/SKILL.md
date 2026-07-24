---
name: r7-compare-disk
description: Transport для r7-compare-docs — list/fetch шаблонов и хост-документа через Р7-Диск API (без VFS snapshot); авто-поиск папки templates; plan B — резолв B по имени файла.
version: 1.2.9
mcp_spec:
  default_capabilities:
    required:
      - type: key-value-storage
        scope: $USER
        operations:
          - Get
          - Set
  tools:
    - name: r7_list_disk_templates
      description: Список шаблонов (.md/.docx) в папке templates (авто-поиск); кэш CompareResults.
      environment:
        user:
          R7_DISK_BASE_URL:
            title: Базовый URL Р7-Диска
            format: string
          R7_DISK_LOGIN:
            title: Логин
            format: string
          R7_DISK_PASSWORD:
            title: Пароль
            format: string
            secret: true
    - name: r7_fetch_disk_template
      description: Скачать шаблон по имени или document_id, вернуть text (max 150000 байт).
    - name: r7_fetch_disk_document
      description: Скачать хост-документ по document_id из r7-disk-ref, вернуть text (max 200000 байт).
---

# r7-compare-disk

Monolith transport-навык для агента **r7-compare-docs**. Читает шаблоны и хост-документ через Р7-Диск API — **не** использует VFS snapshot и **не** вызывает `r7-disk-api`.

## Установка (минимум)

- `R7_DISK_BASE_URL` — API-хост диска (`cddisk.*`)
- `R7_DISK_LOGIN` / `R7_DISK_PASSWORD`

`templates` — папка в **«Мои документы»** (латиница, регистр не важен). Плагин **не** передаёт id папки.

## Tools

| Tool | Когда | Вход |
|------|-------|------|
| `r7_list_disk_templates` | START | `{ host_document_id }` — при disk-ref; опц. `host_file_name` |
| `r7_fetch_disk_template` | COMPARE (A) | `{ template_name }` или `{ document_id }`; опц. `host_document_id` (тот же B) |
| `r7_fetch_disk_document` | COMPARE (B) | `{ host_document_id }` + `host_file_name` |

**Plan B:** плагин передаёт **имя** открытого файла (`file_name` из title редактора). Навык ищет `document_id` в дереве «Мои документы» (как `resolveDocumentIdForFile` в examples_sergey), в том числе если переданный `host_document_id` не скачивается (HTTP 404). `doc.html?id=` от плагина **не обязателен**.

На START навык кэширует в skillStorage: `my_documents_directory_id`, `compare_results_folder_id`.

Контракт: [`docs/r7-disk-ref-contract.md`](../docs/r7-disk-ref-contract.md).
