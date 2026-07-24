---
name: analytics_csv_select
description: Аналитика продаж CSV на Р7 Диске с выбором исходного файла через поиск папки и последующей генерацией XLSX-отчёта.
version: 8.9.0
tags:
  - analytics
  - csv
  - r7-disk
  - sales
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
    - name: analytics_list_source_files
      description: Ищет папку с CSV, возвращает список файлов или fallback-список папок; поддерживает текущий документ из контекста R7.
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
      schemas:
        input:
          type: object
          additionalProperties: false
          properties:
            folder_name:
              type: string
            directory_id:
              oneOf:
                - type: integer
                - type: string
            file_extension:
              type: string
            use_current_document:
              type: boolean
            document_id:
              oneOf:
                - type: integer
                - type: string
            file_name:
              type: string
        output:
          type: object
          additionalProperties: true
          properties:
            current_file_is_csv:
              type: boolean
            fallback_to_other_files:
              type: boolean
            csv_name:
              type: string
            csv_document_id:
              oneOf:
                - type: integer
                - type: string
            is_shared:
              type: boolean
            needs_personal_upload:
              type: boolean
            document_id:
              oneOf:
                - type: integer
                - type: string
    - name: analytics_csv_generate_report
      description: Скачивает CSV с Р7 Диск по document_id или имени, анализирует продажи и загружает XLSX-отчёт.
      schemas:
        input:
          type: object
          additionalProperties: false
          properties:
            directory_id:
              oneOf:
                - type: integer
                - type: string
              description: ID папки для сохранения отчёта (если доступна запись).
            csv_name:
              type: string
            csv_document_id:
              oneOf:
                - type: integer
                - type: string
            is_shared:
              type: boolean
            needs_personal_upload:
              type: boolean
            upload_to_personal:
              type: boolean
            output_directory_id:
              oneOf:
                - type: integer
                - type: string
            output_name:
              type: string
            conflict_policy:
              type: string
        output:
          type: object
          additionalProperties: true
          required:
            - ok
            - operation
---

# Аналитика CSV с выбором файла на диске

Навык состоит из двух инструментов:

1. `analytics_list_source_files` — document-id-first для текущего документа; для других файлов находит папку `Таблицы для отчета` или список папок под `Мои документы`.
2. `analytics_csv_generate_report` — скачивает CSV по `csv_document_id` (приоритет) или `GetIdByName`, формирует XLSX; для расшаренных CSV сохраняет отчёт в «Мои документы».

## Рабочий сценарий

- **Старт (0 tools):** агент приветствует и задаёт один вопрос с двумя вариантами (отчёт по текущему документу / другие файлы). Контекст R7 (`document_id`, `file_name`) — не считается выбором пользователя.
- **После выбора «данный документ»:** `analytics_list_source_files` с `use_current_document: true` (без озвучивания «проверки» в чате).
- `current_file_is_csv: true` → `analytics_csv_generate_report` (без доп. подтверждения).
- `current_file_is_csv: false` → поиск других файлов.
- **После выбора «другие файлы»:** list по папке / списку, затем report по явной команде пользователя.
- После успешного отчёта не повторяй tool без нового запроса пользователя.

## Важно для агента

- Не проси пользователя вручную вводить `directory_id` на старте.
- Не выдумывай папки/файлы: используй только `files` или `folders` из ответа list-tool.
- **Не спрашивай** URL/логин/пароль Р7 Диска — `R7_DISK_*` берутся из настроек установки навыка автоматически. Вызывай tools без полей `login`/`password`/`base_url`/`auth_token`.

## Подготовка (install-time, не в чате)

| Переменная | Обязательность | Пример |
|---|---|---|
| `R7_DISK_BASE_URL` | да | `https://cddisk.gptz.lad-soft.ru` |
| `R7_DISK_LOGIN` | да | логин |
| `R7_DISK_PASSWORD` | да | пароль |

Токен кэшируется в `skillStorage` между вызовами.
