---
name: sort_rows
description: >-
  Сорт в /session/*_sort.xlsx (targetPath ИГНОРИРУЕТСЯ — не передавай).
  sortBy по приоритету. Natural order для Сотр_1…Сотр_10.
  ok+stop+userReply → ответ = userReply, STOP. Запрещён bash/cp/mv/inspect после.
runtime: python@3
scriptFile: sort_rows.py
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
        description: Игнорируется. Не указывай /session/r7/.
      targetSheet:
        type: string
      sortBy:
        type: array
        items:
          type: string
      sortField:
        type: string
      ascending:
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
