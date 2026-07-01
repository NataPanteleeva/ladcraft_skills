---
name: r7_disk_download
description: Скачивание файла с Р7-Диска — кнопка «Скачать файл» в виджете fileDownloadCard. Только directory_id + name.
scriptFile: r7_disk_download.js
schemas:
  input:
    type: object
    additionalProperties: false
    required:
      - directory_id
      - name
    properties:
      directory_id:
        oneOf:
          - type: integer
          - type: string
        description: ID папки, где лежит файл.
      name:
        type: string
        description: Имя файла в папке (например тестовый.txt).
      file_name:
        type: string
        description: Синоним name.
      auth_token:
        type: string
      base_url:
        type: string
      login:
        type: string
      password:
        type: string
      force_redownload:
        type: boolean
        description: Принудительно скачать файл снова (обход dedup).
      force_repeat:
        type: boolean
        description: Синоним force_redownload для обхода dedup.
  output:
    type: object
    additionalProperties: true
    required:
      - ok
    properties:
      ok:
        type: boolean
      action:
        type: string
      document_id:
        type: integer
      directory_id:
        type: integer
      file_name:
        type: string
      content_base64:
        type: string
      content_type:
        type: string
      size_bytes:
        type: integer
      deliverable:
        type: boolean
      show_download_widget:
        type: boolean
      download_fresh:
        type: boolean
      agent_message:
        type: string
      error:
        type: string
auth: null
resources:
  cpu: 0.2
  memory: 128
  timeout: 60
  network:
    hosts:
      - cddisk.gptz.lad-soft.ru
      - cddisk.stand.lad-soft.ru
      - cddisk.r7o.ro
---

