---
name: inspect_workbook
description: >-
  Читает .xlsx из VFS: листы, заголовки, sample строк, типы колонок и suggestedPivot
  для построения сводной таблицы.
runtime: python@3
scriptFile: inspect_workbook.py
schemas:
  input:
    type: object
    additionalProperties: false
    required:
      - path
    properties:
      path:
        type: string
        description: Путь к .xlsx в VFS, например /session/Продажи_1000.xlsx
      sheet:
        type: string
        description: Имя листа (по умолчанию первый)
      sampleRows:
        type: number
        description: Сколько строк sample вернуть (1..20, по умолчанию 5)
  output:
    type: object
    additionalProperties: false
    required:
      - ok
    properties:
      ok:
        type: boolean
      error:
        type: string
      path:
        type: string
      sheets:
        type: array
        items:
          type: string
      sheet:
        type: string
      headers:
        type: array
        items:
          type: string
      rowCount:
        type: number
      sample:
        type: array
      columns:
        type: array
      suggestedPivot:
        type: object
resources:
  cpu: 0.5
  memory: 256
  timeout: 120
  network:
    hosts: []
---

Инспекция workbook и эвристика suggestedPivot.
