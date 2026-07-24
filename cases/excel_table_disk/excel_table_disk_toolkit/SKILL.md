---
name: excel_table_disk_toolkit
description: >-
  Табличная аналитика на Р7-Диске без VFS: список папок/.xlsx и операции
  profile/filter/pivot/top_n/compare с выгрузкой результата на диск.
version: 1.0.0
tags:
  - excel
  - xlsx
  - r7-disk
  - analytics
category: productivity
mcp_spec:
  default_capabilities:
    required:
      - type: key-value-storage
        scope: $USER
        operations:
          - Get
          - Set
  tools:
    - name: list_xlsx_on_disk
      environment:
        user:
          R7_DISK_BASE_URL:
            title: Базовый URL Р7-Диска
            format: string
          R7_DISK_LOGIN:
            title: Логин Р7-Диска
            format: string
          R7_DISK_PASSWORD:
            title: Пароль Р7-Диска
            format: string
            secret: true
    - name: disk_table_op
---

# Excel Table Disk Toolkit

Server-вариант табличной аналитики: источники и результат на **Р7-Диске**, без session VFS.

## Tools

### `list_xlsx_on_disk`
Папки и `.xlsx`. Параметры: `use_current_document`, `folder_name`, `directory_id`, `list_root`.

### `disk_table_op`
`operation`: `profile` | `filter` | `pivot` | `top_n` | `compare`.  
Вход: `document_id` (и `document_id_b` для compare). Выход — новый файл на диске + `agent_message`.

## Креды

`R7_DISK_BASE_URL`, `R7_DISK_LOGIN`, `R7_DISK_PASSWORD` в environment.user установки навыка.
