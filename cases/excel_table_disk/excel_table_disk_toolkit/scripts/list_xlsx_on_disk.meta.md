---
name: list_xlsx_on_disk
description: >-
  Список папок и .xlsx на Р7-Диске. use_current_document — текущий файл из плагина;
  folder_name / directory_id — обзор; list_root — корень «Мои документы».
runtime: nodejs@24
scriptFile: list_xlsx_on_disk.js
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
      list_root:
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
    required:
      - ok
resources:
  cpu: 0.3
  memory: 128
  timeout: 120
  network:
    hosts:
      - cddisk.gptz.lad-soft.ru
      - cddisk.stand.lad-soft.ru
      - cddisk.r7o.ro
---

Список Excel на Р7-Диске.
