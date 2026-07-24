---
name: r7_fetch_disk_document
description: Скачивает хост-документ с Р7-Диска по host_file_name или document_id (max 200000 байт).
scriptFile: r7_fetch_disk_document.js
schemas:
  input:
    type: object
    additionalProperties: false
    properties:
      host_file_name:
        type: string
        description: Имя хост-документа (plan B — навык ищет в «Мои документы»).
      host_document_id:
        type: integer
        description: Опциональный id, если уже известен с START.
      document_id:
        type: integer
        description: Синоним host_document_id.
      file_name:
        type: string
        description: Синоним host_file_name.
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
