---
name: r7_render_docx
description: Собирает .docx из CompareReport JSON (doc-compare/v1) без python/bash. Возвращает content_base64 для r7-export-compare.
scriptFile: r7_render_docx.js
schemas:
  input:
    type: object
    additionalProperties: true
    properties:
      report:
        type: object
        description: CompareReport doc-compare/v1 (объект, не JSON-строка).
        additionalProperties: true
      title:
        type: string
      sections:
        type: array
      outputFileName:
        type: string
      suggestedFileName:
        type: string
  output:
    type: object
    additionalProperties: true
    required:
      - ok
    properties:
      ok:
        type: boolean
      content_base64:
        type: string
      localPath:
        type: string
      fileName:
        type: string
      mimeType:
        type: string
      error:
        type: string
      agent_message:
        type: string
auth: null
---

