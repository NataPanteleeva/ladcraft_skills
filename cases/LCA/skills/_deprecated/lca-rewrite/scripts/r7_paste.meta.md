---
name: r7_paste
description: Вставка HTML в позицию курсора (PasteHtml).
scriptFile: r7_paste.js
resources:
  timeout: 30
  cpu: 0.2
  memory: 128
schemas:
  input:
    type: object
    additionalProperties: true
    properties:
      html:
        type: string
        description: HTML для вставки
      data:
        type: string
        description: Альтернатива html
      text:
        type: string
        description: Альтернатива html
  output:
    type: object
    additionalProperties: true
    required:
      - ok
    properties:
      ok:
        type: boolean
      error:
        type: string
auth: null
---
