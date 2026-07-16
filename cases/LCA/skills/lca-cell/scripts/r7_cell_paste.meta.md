---
name: r7_cell_paste
description: Запись значений в ячейки Cell.
scriptFile: r7_cell_paste.js
resources:
  timeout: 30
  cpu: 0.2
  memory: 128
schemas:
  input:
    type: object
    additionalProperties: true
    properties:
      data:
        type: object
        description: Карта A1 → значение
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
