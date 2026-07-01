---
name: r7_disk_list_directory
description: Возвращает подпапки и документы через GET /api/v1/DocumentDirectory/Get.
scriptFile: r7_disk_list_directory.js
schemas:
  input:
    type: object
    additionalProperties: false
    properties:
      directory_id:
        type: integer
        description: Опционально. Без него — корень disk_section (обычно «Мои документы» после login).
      disk_section:
        type: string
        description: docs | shared_to_me | common | favorites | recent | file_depot и др.
      web_url:
        type: string
        description: URL вида https://.../docs или /docs/50 — парсится в directory_id.
      auth_token:
        type: string
      base_url:
        type: string
      login:
        type: string
      password:
        type: string
      force_repeat:
        type: boolean
        description: Принудительно обновить listing (обход dedup).
  output:
    type: object
    additionalProperties: true
    required:
      - ok
    properties:
      ok:
        type: boolean
      directory_id:
        type: integer
      directory_name:
        type: string
      parent:
        type: object
        additionalProperties: true
      parent_directory_id:
        type: integer
      parent_directory_name:
        type: string
      listing_scope_note:
        type: string
        description: Пояснение, что показана одна папка, а не весь диск — выводи пользователю.
      disk_section:
        type: string
      parent_chain:
        type: array
        items:
          type: object
          additionalProperties: true
      is_personal_tree:
        type: boolean
      is_empty:
        type: boolean
      storage_state:
        type: string
      create_target:
        type: object
        additionalProperties: true
      web_url_hint:
        type: string
      scope_warning:
        type: string
      agent_message:
        type: string
      auth_from_cache:
        type: boolean
      session_note:
        type: string
      forbid_followup_tools:
        type: array
        items:
          type: string
      documents_filtered_out:
        type: integer
      folders:
        type: array
        items:
          type: object
          additionalProperties: true
      documents:
        type: array
        items:
          type: object
          additionalProperties: true
      counters:
        type: object
        additionalProperties: true
      error:
        type: string
auth: null
resources:
  cpu: 0.3
  memory: 128
  timeout: 45
  network:
    hosts:
      - cddisk.gptz.lad-soft.ru
      - cddisk.stand.lad-soft.ru
      - cddisk.r7o.ro
---

