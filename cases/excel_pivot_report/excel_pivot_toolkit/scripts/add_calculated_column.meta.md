---
name: add_calculated_column
description: >-
  Добавляет колонку по expression из имён колонок и + - * / (например «Количество * Цена»).
  Пишет результат в targetPath.
runtime: python@3
scriptFile: add_calculated_column.py
schemas:
  input:
    type: object
    additionalProperties: false
    required:
      - sourcePath
      - newColumn
      - expression
    properties:
      sourcePath:
        type: string
      sourceSheet:
        type: string
      targetPath:
        type: string
      targetSheet:
        type: string
      newColumn:
        type: string
      expression:
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

Расчётная колонка.
