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
        description: ID папки Р7 Диск с CSV и для сохранения отчёта (если доступна запись).
      csv_name:
        type: string
        description: Имя CSV-файла.
      csv_document_id:
        oneOf:
          - type: integer
          - type: string
        description: ID CSV для скачивания через Documents/Download (приоритет над GetIdByName).
      is_shared:
        type: boolean
        description: Исходный CSV расшарен — отчёт сохраняется в «Мои документы».
      needs_personal_upload:
        type: boolean
        description: Сохранить отчёт в «Мои документы» вместо папки CSV.
      upload_to_personal:
        type: boolean
        description: Синоним needs_personal_upload.
      output_directory_id:
        oneOf:
          - type: integer
          - type: string
        description: Явный ID папки для сохранения отчёта (override personal root).
      output_name:
        type: string
        description: Имя XLSX-отчёта. По умолчанию отчет_продаж.xlsx.
      conflict_policy:
        type: string
        description: overwrite | suffix | error. По умолчанию overwrite.
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
---
