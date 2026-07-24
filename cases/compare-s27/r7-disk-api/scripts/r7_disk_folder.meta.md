---
name: r7_disk_folder
description: Операции с папками Р7-Диска (create, move, copy, delete, restore, conflict) через DocumentDirectory API.
scriptFile: r7_disk_folder.js
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
        description: create | move | copy | delete | restore | conflict | rename (невозможно — impossible true). **Основной ключ**.
      action:
        type: string
        description: Устаревший синоним operation.
      parent_directory_id:
        oneOf:
          - type: integer
          - type: string
        description: Родитель для create. Берите из create_target.parent_directory_id после r7_disk_login.
      my_documents_directory_id:
        oneOf:
          - type: integer
          - type: string
        description: Синоним parent_directory_id (из my_documents_directory_id login).
      names:
        type: array
        items:
          type: string
        description: Несколько папок в одном родителе (create). Альтернатива повторным вызовам с name.
      folder_id:
        type: integer
        description: ID папки для move, copy, delete; один ID для restore/conflict.
      folder_ids:
        type: array
        items:
          type: integer
        description: Список ID для restore/conflict.
      to_directory_id:
        type: integer
        description: Папка назначения для move, copy, conflict.
      name:
        type: string
        description: Имя одной новой папки (create).
      folder_path:
        type: string
        description: Вложенный путь через /, например "Отчёты/2026" (create, цепочка подпапок).
      rule:
        type: integer
        description: 'Правило копирования: 0 — отказ при конфликте, 1 — перезапись, 2 — переименование (по умолчанию 0).'
      auth_token:
        type: string
        description: Токен из r7_disk_login. Обязателен при create сразу после login — кэш skillStorage между tool-вызовами может быть пуст.
      base_url:
        type: string
      login:
        type: string
      password:
        type: string
  output:
    type: object
    additionalProperties: false
    required:
      - ok
    properties:
      ok:
        type: boolean
      impossible:
        type: boolean
      action:
        type: string
      folder_id:
        type: integer
      folder_name:
        type: string
      folder_ids:
        type: array
        items:
          type: integer
      parent_directory_id:
        type: integer
      to_directory_id:
        type: integer
      rule:
        type: integer
      created_folders:
        type: array
        items:
          type: object
          additionalProperties: true
      data:
        type: object
        additionalProperties: true
      api_base_url:
        type: string
      error:
        type: string
auth: null
resources:
  cpu: 0.3
  memory: 128
  timeout: 60
  network:
    hosts:
      - cddisk.gptz.lad-soft.ru
      - cddisk.stand.lad-soft.ru
      - cddisk.r7o.ro
---

