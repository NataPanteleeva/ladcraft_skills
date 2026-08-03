---
name: r7_paste_text
description: Вставка сгенерированного plain text у курсора.
scriptFile: r7_paste_text.js
resources:
  timeout: 30
  cpu: 0.2
  memory: 128
schemas:
  input:
    type: object
    additionalProperties: true
    properties:
      text:
        type: string
      data:
        type: string
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
