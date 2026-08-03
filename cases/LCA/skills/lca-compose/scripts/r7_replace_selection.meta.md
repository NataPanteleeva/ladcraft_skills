---
name: r7_replace_selection
description: Заменяет выделение в Word (RemoveSelectedContent + paste).
scriptFile: r7_replace_selection.js
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
        description: Новый текст или HTML
      html:
        type: string
        description: HTML фрагмента
      data:
        type: string
        description: Альтернатива text
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
