---
name: analytics_csv_select
description: Аналитика продаж CSV на Р7 Диске с выбором исходного файла через поиск папки и последующей генерацией XLSX-отчёта.
version: 3.0.1
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
          ANALYTICS_REPORT_FOLDER_NAME:
            title: Имя папки для поиска CSV
            format: string
            description: По умолчанию Таблицы для отчета.
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
            document_id:
              oneOf:
                - type: integer
                - type: string
    - name: analytics_csv_generate_report
      description: Скачивает CSV с Р7 Диск, анализирует продажи и загружает XLSX-отчёт в ту же папку.
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
          ANALYTICS_CSV_DIRECTORY_ID:
            title: Fallback ID папки (для smoke)
            format: number
            description: Используется только если directory_id не передан в tool.
          ANALYTICS_CSV_DEFAULT_INPUT_NAME:
            title: Fallback имя CSV
            format: string
            description: Используется только если csv_name не передан в tool.
          ANALYTICS_CSV_DEFAULT_OUTPUT_NAME:
            title: Имя XLSX-отчёта по умолчанию
            format: string
            description: По умолчанию отчет_продаж.xlsx.
      schemas:
        input:
          type: object
          additionalProperties: false
          properties:
            directory_id:
              oneOf:
                - type: integer
                - type: string
              description: ID папки Р7 Диск.
            csv_name:
              type: string
            output_name:
              type: string
            conflict_policy:
              type: string
            auth_token:
              type: string
            base_url:
              type: string
            login:
              type: string
            password:
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

1. `analytics_list_source_files` — находит папку `Таблицы для отчета`, показывает CSV для выбора, а если папка не найдена, возвращает список папок под `Мои документы`. С `use_current_document: true` проверяет текущий документ из контекста R7.
2. `analytics_csv_generate_report` — формирует XLSX `отчет_продаж.xlsx` из выбранного CSV в той же папке.

## Рабочий сценарий

- Старт: текущий документ (`use_current_document`) или поиск папки с CSV.
- Если текущий документ — CSV, сразу вызывай `analytics_csv_generate_report`.
- Если текущий документ не CSV — переходи к поиску других файлов.
- После выбора CSV из списка вызывай `analytics_csv_generate_report` один раз.
- После успешного отчёта не повторяй tool без нового запроса пользователя.

## Важно для агента

- Не проси пользователя вручную вводить `directory_id` на старте.
- Не выдумывай папки/файлы: используй только `files` или `folders` из ответа list-tool.
