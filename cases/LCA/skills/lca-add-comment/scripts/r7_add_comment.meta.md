---
name: r7_add_comment
description: Комментарий рецензента в Word.
scriptFile: r7_add_comment.js
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
        description: Текст комментария
    required:
      - text
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
