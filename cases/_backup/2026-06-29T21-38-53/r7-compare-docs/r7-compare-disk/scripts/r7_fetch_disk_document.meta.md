---
name: r7_fetch_disk_document
description: Скачивает хост-документ с Р7-Диска по document_id, возвращает text (max 200000 байт).
scriptFile: r7_fetch_disk_document.js
schemas:
  input:
    type: object
    additionalProperties: false
    required:
      - document_id
    properties:
      document_id:
        type: integer
        description: document_id из mentioned.files (r7-disk:ID).
      file_name:
        type: string
        description: Имя файла для выбора парсера (.md/.docx).
  output:
    type: object
    additionalProperties: true
    required:
      - ok
    properties:
      ok:
        type: boolean
      text:
        type: string
      truncated:
        type: boolean
      document_id:
        type: integer
      file_name:
        type: string
      source:
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
