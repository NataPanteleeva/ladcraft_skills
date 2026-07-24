---
name: r7_save_compare_report_to_disk
description: DOCX отчёта → Р7-Диск/CompareResults (content_base64 или markdown).
scriptFile: r7_save_compare_report_to_disk.js
schemas:
  input:
    type: object
    additionalProperties: false
    properties:
      content_base64:
        type: string
        description: DOCX из r7_render_docx (приоритет).
      markdown:
        type: string
        description: Markdown-отчёт (fallback).
      fileName:
        type: string
        description: Имя DOCX.
      folderName:
        type: string
        description: Папка (по умолчанию CompareResults).
      folder_id:
        type: integer
        description: Опционально. ID папки CompareResults — override без поиска корня.
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
capabilities:
  required:
    - type: key-value-storage
      scope: $USER
      operations:
        - Get
        - Set
resources:
  cpu: 0.3
  memory: 192
  timeout: 120
  network:
    hosts:
      - cddisk.gptz.lad-soft.ru
      - cddisk.stand.lad-soft.ru
      - cddisk.r7o.ro
