---
name: r7_deliver_docx
description: Загружает DOCX в session VFS и возвращает r7.task deliver_file с реальным fileId.
scriptFile: r7_deliver_docx.js
schemas:
  input:
    type: object
    additionalProperties: true
    properties:
      content_base64:
        type: string
        description: Base64 DOCX из r7_render_docx (предпочтительно).
      localPath:
        type: string
        description: Путь в skill VFS, если нет content_base64.
      fileName:
        type: string
      mimeType:
        type: string
      actions:
        type: array
        items:
          type: string
      render:
        type: object
        description: Полный ответ r7_render_docx (альтернатива отдельным полям).
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
---

