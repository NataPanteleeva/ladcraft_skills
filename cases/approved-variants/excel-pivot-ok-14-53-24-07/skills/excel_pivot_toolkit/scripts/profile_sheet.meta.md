---
name: profile_sheet
description: >-
  Профиль листа: null%, уникальные, min/max, топ значений, опционально дубликаты по ключу.
  Пишет лист «Профиль» в targetPath (vfs.writeFile).
runtime: python@3
scriptFile: profile_sheet.py
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
      topN:
        type: number
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

Профиль колонок листа Excel.
