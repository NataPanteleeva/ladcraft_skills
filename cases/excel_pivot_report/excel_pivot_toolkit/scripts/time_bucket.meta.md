---
name: time_bucket
description: >-
  Добавляет колонку периода (day|week|month|year) по dateField; пишет targetPath.
runtime: python@3
scriptFile: time_bucket.py
schemas:
  input:
    type: object
    additionalProperties: false
    required:
      - sourcePath
      - dateField
    properties:
      sourcePath:
        type: string
      sourceSheet:
        type: string
      targetPath:
        type: string
      targetSheet:
        type: string
      dateField:
        type: string
      bucket:
        type: string
      newColumn:
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

Группировка дат по периоду.
