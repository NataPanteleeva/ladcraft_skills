---
name: analytics_list_source_files
description: Ищет папку с CSV для отчёта и возвращает список файлов для выбора пользователем.
runtime: nodejs@24
scriptFile: analytics_list_source_files.js
schemas:
  input:
    type: object
    additionalProperties: false
    properties:
      folder_name:
        type: string
        description: Имя папки для поиска, по умолчанию Таблицы для отчета.
      directory_id:
        oneOf:
          - type: integer
          - type: string
        description: Явный ID папки, если пользователь выбрал её из fallback-списка.
      file_extension:
        type: string
        description: Расширение файлов для фильтра, по умолчанию .csv.
      use_current_document:
        type: boolean
        description: Разрешить текущий документ из контекста R7 вместо поиска папки.
      document_id:
        oneOf:
          - type: integer
          - type: string
        description: ID текущего документа на Р7 Диске (из supplement или r7-disk file_id).
      file_name:
        type: string
        description: Имя текущего документа из контекста R7.
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
      - folder_found
    properties:
      ok:
        type: boolean
      folder_found:
        type: boolean
      current_file_is_csv:
        type: boolean
        description: true если текущий документ — CSV и можно сразу строить отчёт.
      fallback_to_other_files:
        type: boolean
        description: true если текущий документ не CSV — перейти к поиску других файлов.
      csv_name:
        type: string
        description: Имя CSV при source=current_document.
      document_id:
        type: integer
      file_name:
        type: string
      directory_id:
        type: integer
      directory_name:
        type: string
      files:
        type: array
        items:
          type: object
          additionalProperties: true
      folders:
        type: array
        items:
          type: object
          additionalProperties: true
      agent_message:
        type: string
      error:
        type: string
resources:
  cpu: 0.5
  memory: 256
  timeout: 180
  network:
    hosts:
      - cddisk.gptz.lad-soft.ru
      - cddisk.stand.lad-soft.ru
      - cddisk.r7o.ro
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
---
