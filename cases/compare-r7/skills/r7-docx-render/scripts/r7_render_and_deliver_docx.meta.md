---
name: r7_render_and_deliver_docx
description: >-
  Атомарный export compare-r7: CompareReport → DOCX → session VFS upload → r7.task deliver_file.
  Без content_base64 и без отдельного r7_deliver_docx.
scriptFile: r7_render_and_deliver_docx.js
schemas:
  input:
    type: object
    additionalProperties: true
    properties:
      report:
        type: object
        description: CompareReport doc-compare/v1 (объект, не JSON-строка).
        additionalProperties: true
      actions:
        type: array
        items:
          type: string
  output:
    type: object
    additionalProperties: true
    required:
      - ok
    properties:
      ok:
        type: boolean
      fileId:
        type: string
      fileName:
        type: string
      mimeType:
        type: string
      r7_task:
        type: array
      r7_task_block:
        type: string
      error:
        type: string
      agent_message:
        type: string
auth: null
capabilities:
  required:
    - type: vfs
      scope: session
      operations:
        - upload
        - uploadFile
resources:
  cpu: 0.3
  memory: 192
  timeout: 120
  network:
    hosts: []
---
