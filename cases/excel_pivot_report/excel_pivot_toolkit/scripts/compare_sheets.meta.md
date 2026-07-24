---
name: compare_sheets
description: >-
  Сверка двух листов одной книги по keyFields: diff | join | reconcile (valueField + tolerance).
  Пишет *_сверка.xlsx с листами результата.
runtime: python@3
scriptFile: compare_sheets.py
schemas:
  input:
    type: object
    additionalProperties: false
    required:
      - sourcePath
      - sheetA
      - sheetB
    properties:
      sourcePath:
        type: string
      sheetA:
        type: string
      sheetB:
        type: string
      keyFields:
        type: array
        items:
          type: string
      mode:
        type: string
        description: diff | join | reconcile
      valueField:
        type: string
      tolerance:
        type: number
      targetPath:
        type: string
  output:
    type: object
    additionalProperties: true
    required:
      - ok
resources:
  cpu: 0.5
  memory: 256
  timeout: 180
  network:
    hosts: []
---

Сверка двух листов книги.
