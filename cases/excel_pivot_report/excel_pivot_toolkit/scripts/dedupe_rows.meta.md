---
name: dedupe_rows
description: >-
  Убирает дубликаты по keyFields (keep first|last) и опционально нормализует заголовки.
  Пишет очищенную таблицу в targetPath.
runtime: python@3
scriptFile: dedupe_rows.py
schemas:
  input:
    type: object
    additionalProperties: false
    required:
      - sourcePath
    properties:
      sourcePath:
        type: string
      sourceSheet:
        type: string
      targetPath:
        type: string
      targetSheet:
        type: string
      keyFields:
        type: array
        items:
          type: string
        description: Если пусто — только normalizeHeaders
      keep:
        type: string
        description: first | last
      normalizeHeaders:
        type: boolean
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

Очистка дубликатов и заголовков.
