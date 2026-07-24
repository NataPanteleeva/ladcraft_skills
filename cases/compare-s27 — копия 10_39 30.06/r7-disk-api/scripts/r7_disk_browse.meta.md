---
name: r7_disk_browse
description: Рекурсивно обходит дерево папок Р7-Диска через DocumentDirectory/Get.
scriptFile: r7_disk_browse.js
schemas:
  input:
    type: object
    additionalProperties: false
    properties:
      directory_id:
        type: integer
        description: Опционально. Без него — обход от корня disk_section (авто после login).
      disk_section:
        type: string
      web_url:
        type: string
        description: URL /docs или /docs/50.
      folder_name:
        type: string
        description: Имя папки для корня обхода (например Ladcraft_Проверка). Ищется под «Мои документы»; не спрашивать id у пользователя.
      folder_path:
        type: string
        description: Путь от «Мои документы» через / (например Ladcraft_Проверка/Отчёты).
      max_depth:
        type: integer
        description: Опционально для агента (1–8). По умолчанию 5 — пользователю не показывать.
      auth_token:
        type: string
      base_url:
        type: string
      login:
        type: string
      password:
        type: string
  output:
    type: object
    additionalProperties: true
    required:
      - ok
      - tree
    properties:
      ok:
        type: boolean
      tree:
        type: object
        additionalProperties: true
      all_documents:
        type: array
        description: Все файлы под корнем обхода (плоский список с folder_path).
        items:
          type: object
          additionalProperties: true
      all_folders:
        type: array
        items:
          type: object
          additionalProperties: true
      total_documents:
        type: integer
      total_folders:
        type: integer
      max_depth:
        type: integer
      browse_root_id:
        type: integer
      browse_root_name:
        type: string
      disk_section:
        type: string
      parent_chain:
        type: array
        items:
          type: object
          additionalProperties: true
      is_personal_tree:
        type: boolean
      web_url_hint:
        type: string
      scope_warning:
        type: string
      browse_scope_note:
        type: string
      tree_text:
        type: string
        description: Готовое ASCII-дерево для ответа пользователю.
      agent_message:
        type: string
      do_not_retry:
        type: boolean
      error:
        type: string
auth: null
resources:
  cpu: 0.4
  memory: 256
  timeout: 60
  network:
    hosts:
      - cddisk.gptz.lad-soft.ru
      - cddisk.stand.lad-soft.ru
      - cddisk.r7o.ro
---

