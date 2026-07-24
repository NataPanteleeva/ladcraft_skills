---
name: r7_disk_set_my_documents_directory_id
description: Сохраняет id корня «Мои документы» в skillStorage, если он известен из диалога или вычислен по родителю подпапки.
scriptFile: r7_disk_set_my_documents_directory_id.js
schemas:
  input:
    type: object
    additionalProperties: false
    required:
      - directory_id
    properties:
      directory_id:
        type: integer
        description: ID корневой папки «Мои документы» (например 42).
      directory_name:
        type: string
        description: Опционально. Имя корня для agent_message (по умолчанию «Мои документы»).
      force_repeat:
        type: boolean
        description: Принудительно сохранить id повторно (обход dedup).
  output:
    type: object
    additionalProperties: true
    required:
      - ok
    properties:
      ok:
        type: boolean
      my_documents_directory_id:
        type: integer
      directory_name:
        type: string
      persisted:
        type: boolean
      agent_message:
        type: string
      error:
        type: string
auth: null
resources:
  cpu: 0.1
  memory: 64
  timeout: 10
  network:
    hosts: []
---

