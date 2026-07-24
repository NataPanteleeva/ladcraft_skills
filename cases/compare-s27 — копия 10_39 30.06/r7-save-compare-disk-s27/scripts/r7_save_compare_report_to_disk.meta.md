---
name: r7_save_compare_report_to_disk
description: Сохраняет markdown-отчёт сравнения на Р7-Диск в папку CompareResults как DOCX (login + folder + upload).
scriptFile: r7_save_compare_report_to_disk.js
schemas:
  input:
    type: object
    additionalProperties: false
    required:
      - markdown
    properties:
      markdown:
        type: string
        description: Финальный markdown-отчёт сравнения.
      fileName:
        type: string
        description: Имя DOCX (по умолчанию compare-report-YYYY-MM-DD_HH-mm.docx).
      folderName:
        type: string
        description: Имя папки на диске (по умолчанию CompareResults).
  output:
    type: object
    additionalProperties: true
    required:
      - ok
    properties:
      ok:
        type: boolean
      folder_name:
        type: string
      folder_id:
        type: integer
      file_name:
        type: string
      document_id:
        type: integer
      web_ui_hint:
        type: string
      agent_message:
        type: string
      error:
        type: string
auth: null
capabilities:
  required:
    - type: key-value-storage
      scope: $USER
      operations:
        - Get
        - Set
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
resources:
  cpu: 0.3
  memory: 192
  timeout: 120
  network:
    hosts:
      - cddisk.gptz.lad-soft.ru
      - cddisk.stand.lad-soft.ru
      - cddisk.r7o.ro
---
