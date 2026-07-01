---
name: r7_list_disk_templates
description: Список шаблонов в папке templates; резолв хост-документа по имени в «Мои документы»; кэш CompareResults.
scriptFile: r7_list_disk_templates.js
schemas:
  input:
    type: object
    additionalProperties: false
    properties:
      host_file_name:
        type: string
        description: Имя хост-документа из supplement (подпись; fallback если нет id).
      host_document_id:
        type: integer
        description: Id хост-документа из плагина (r7-disk:{id}) — основной вход.
      directory_id:
        type: integer
        description: Опциональный override id папки templates (отладка).
  output:
    type: object
    additionalProperties: true
    required:
      - ok
    properties:
      ok:
        type: boolean
      templates:
        type: array
      host_document_id:
        type: integer
      host_file_name:
        type: string
      host_resolved_via:
        type: string
      directory_id:
        type: integer
      my_documents_directory_id:
        type: integer
      compare_results_folder_id:
        type: integer
      source:
        type: string
      error:
        type: string
      agent_message:
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
  cpu: 0.2
  memory: 128
  timeout: 90
  network:
    hosts:
      - cddisk.gptz.lad-soft.ru
      - cddisk.stand.lad-soft.ru
      - cddisk.r7o.ro
