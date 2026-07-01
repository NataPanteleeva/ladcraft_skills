---
name: r7_disk_login
description: Авторизуется в Р7-Диске. При заполненном environment без credential_source возвращает needs_credential_choice — агент должен спросить пользователя (сохранённые переменные или другой диск).
scriptFile: r7_disk_login.js
schemas:
  input:
    type: object
    additionalProperties: false
    properties:
      base_url:
        type: string
        description: Переопределяет R7_DISK_BASE_URL.
      login:
        type: string
      password:
        type: string
      credential_source:
        type: string
        description: environment | custom. Без значения при заполненном environment — needs_credential_choice.
      web_url:
        type: string
        description: URL веб-интерфейса (/docs, /docs/50) — для якоря и определения корня.
      anchor_directory_id:
        type: integer
        description: ID известной подпапки — корень «Мои документы» определяется по цепочке Parent.
  output:
    type: object
    additionalProperties: true
    required:
      - ok
    properties:
      ok:
        type: boolean
      auth_token:
        type: string
      expired_at:
        type: string
      user:
        type: object
        additionalProperties: true
      modules_access:
        type: array
        items:
          type: string
      my_documents_directory_id:
        type: integer
        description: ID корневого каталога пользователя; может отсутствовать если null.
      my_documents_accessible:
        type: boolean
      my_documents_probe_status:
        type: integer
      my_documents_note:
        type: string
        description: Итог поиска корня + root_discovery_summary (всегда читать агенту).
      storage_state:
        type: string
        description: personal_empty | personal_with_content | no_personal_only_shared | no_accessible_roots
      is_empty:
        type: boolean
      create_target:
        type: object
        additionalProperties: true
      section_roots:
        type: object
        additionalProperties: true
      web_url_parsed:
        type: object
        additionalProperties: true
      root_discovery_summary:
        type: string
        description: Текстовый отчёт сканирования id до 512 и доступных каталогов.
      accessible_directory_roots:
        type: array
        items:
          type: object
          additionalProperties: true
      user_directory_field_hints:
        type: array
        items:
          type: object
          additionalProperties: true
      standard_folders_warning:
        type: string
      agent_message:
        type: string
      credential_source:
        type: string
      needs_credential_choice:
        type: boolean
      environment_preview:
        type: object
        additionalProperties: true
      api_base_url:
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

