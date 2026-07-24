---
name: r7_fetch_disk_template
description: Скачивает шаблон с Р7-Диска по имени или document_id, возвращает text (max 150000 байт).
scriptFile: r7_fetch_disk_template.js
schemas:
  input:
    type: object
    additionalProperties: false
    properties:
      template_name:
        type: string
        description: Имя файла шаблона в папке templates.
      document_id:
        type: integer
        description: Альтернатива template_name — id документа на диске.
      host_document_id:
        type: integer
        description: Id хост-документа B (тот же, что на START) — для поиска папки templates в «Мои документы».
      host_file_name:
        type: string
        description: Имя хост-документа B (подпись; опционально).
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
