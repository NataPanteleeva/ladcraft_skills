---
name: analytics_csv_generate_report
description: Скачивает CSV с Р7 Диск, строит аналитику продаж через openpyxl и загружает XLSX для редактора таблиц Р7 Офис.
runtime: python@3
scriptFile: analytics_csv_generate_report.py
schemas:
  input:
    type: object
    additionalProperties: false
    properties:
      directory_id:
        oneOf:
          - type: integer
          - type: string
        description: ID папки Р7 Диск с CSV и для сохранения отчёта.
      csv_name:
        type: string
        description: Имя CSV-файла.
      output_name:
        type: string
        description: Имя XLSX-отчёта. По умолчанию отчет_продаж.xlsx.
      conflict_policy:
        type: string
        description: overwrite | suffix | error. По умолчанию overwrite.
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
    properties:
      ok:
        type: boolean
      operation:
        type: string
      directory_id:
        type: integer
      csv_name:
        type: string
      output_name:
        type: string
      output_document_id:
        type: integer
      output_size_bytes:
        type: integer
      summary:
        type: object
        additionalProperties: true
      sheets:
        type: array
        items:
          type: object
          additionalProperties: true
      warnings:
        type: array
        items:
          type: string
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
    ANALYTICS_CSV_DIRECTORY_ID:
      title: Fallback ID папки (для smoke)
      format: number
    ANALYTICS_CSV_DEFAULT_INPUT_NAME:
      title: Fallback имя CSV
      format: string
    ANALYTICS_CSV_DEFAULT_OUTPUT_NAME:
      title: Имя XLSX-отчёта по умолчанию
      format: string
---
