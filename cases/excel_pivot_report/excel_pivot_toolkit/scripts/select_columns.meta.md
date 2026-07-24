---
name: select_columns
description: Оставляет и упорядочивает указанные колонки; пишет таблицу в targetPath.
runtime: python@3
scriptFile: select_columns.py
schemas:
  input:
    type: object
    additionalProperties: false
    required:
      - sourcePath
      - columns
    properties:
      sourcePath:
        type: string
      sourceSheet:
        type: string
      targetPath:
        type: string
      targetSheet:
        type: string
      columns:
        type: array
        items:
          type: string
  output:
    type: object
    additionalProperties: true
    required:
      - ok
resources:
  cpu: 0.5
  memory: 256
  timeout: 120
  network:
    hosts: []
---

Проекция колонок.
