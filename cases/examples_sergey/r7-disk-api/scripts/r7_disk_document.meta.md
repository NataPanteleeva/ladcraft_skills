---
name: r7_disk_document
description: Операции с файлами Р7-Диска (create, upload, replace, prepend, append, rename, move, copy, delete, restore, read_content, versions, convert). Скачивание — tool r7_disk_download.
scriptFile: r7_disk_document.js
schemas:
  input:
    type: object
    additionalProperties: false
    anyOf:
      - required:
          - operation
      - required:
          - action
    properties:
      operation:
        type: string
        description: create | upload | replace | prepend | append | rename | delete | restore | move | copy | exists | get_id_by_name | read_content | versions | change_version | convert. **Основной ключ**.
      action:
        type: string
        description: Устаревший синоним operation.
      document_id:
        oneOf:
          - type: integer
          - type: string
      document_ids:
        type: array
        items:
          type: integer
      file_names:
        type: array
        description: Для delete — имена файлов в directory_id.
        items:
          type: string
      directory_id:
        oneOf:
          - type: integer
          - type: string
        description: Папка для create/upload/replace и др.
      to_directory_id:
        oneOf:
          - type: integer
          - type: string
        description: Папка назначения для move.
      name:
        type: string
        description: Имя файла (create, replace, read_content и др.).
      file_name:
        type: string
        description: Имя файла при upload (альтернатива name).
      content_text:
        type: string
        description: Текст UTF-8 при create/upload/replace/prepend/append. Для .docx — **жирный**, *курсив*.
      content_base64:
        type: string
        description: Содержимое base64 при upload/replace.
      file_id:
        oneOf:
          - type: integer
          - type: string
      save_to_vfs_path:
        type: string
      web_ui_path:
        type: string
      web_ui_base:
        type: string
      mime_type:
        type: string
      convert_type:
        type: string
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
      force_repeat:
        type: boolean
        description: Принудительно повторить операцию записи (обход dedup).
  output:
    type: object
    additionalProperties: true
    required:
      - ok
    properties:
      ok:
        type: boolean
      operation:
        type: string
      action:
        type: string
      document_id:
        type: integer
      directory_id:
        type: integer
      name:
        type: string
      file_name:
        type: string
      content_text:
        type: string
      content_text_verified:
        type: string
      content_truncated:
        type: boolean
      agent_message:
        type: string
      error:
        type: string
auth: null
resources:
  cpu: 0.4
  memory: 256
  timeout: 120
  network:
    hosts:
      - cddisk.gptz.lad-soft.ru
      - cddisk.stand.lad-soft.ru
      - cddisk.r7o.ro
---

