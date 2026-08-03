---
name: r7_paste
description: Вставка сгенерированного HTML у курсора.
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
      data:
        type: string
      text:
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
