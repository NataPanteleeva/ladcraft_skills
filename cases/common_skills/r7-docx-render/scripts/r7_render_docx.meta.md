---
name: r7_render_docx
description: Собирает .docx из CompareReport JSON (doc-compare/v1) без python/bash. Возвращает localPath для r7-export.
scriptFile: r7_render_docx.js
schemas:
  input:
    type: object
    additionalProperties: true
    properties:
      report:
        type: object
        description: CompareReport (schema doc-compare/v1) или legacy JSON с title, sections, outputFileName.
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

