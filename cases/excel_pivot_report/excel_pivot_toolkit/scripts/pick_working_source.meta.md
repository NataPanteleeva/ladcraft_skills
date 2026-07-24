---
name: pick_working_source
description: >-
  Резолвер источника: по умолчанию открытая книга (workbookPath /session/r7/…).
  lastResultPath и KPI/сводные — только при userChoice/hint или если книги нет.
  Если листов у книги несколько — needsUser; иначе sourcePath/sourceSheet сразу.
runtime: python@3
scriptFile: pick_working_source.py
schemas:
  input:
    type: object
    additionalProperties: false
    properties:
      workbookPath:
        type: string
        description: Путь открытой книги из workbook_path / mentioned (приоритет).
      lastResultPath:
        type: string
        description: Прошлый результат — только если пользователь просит его доработать.
      userChoice:
        type: string
        description: id или label выбранного option с прошлого вопроса.
      hint:
        type: string
        description: Фраза пользователя для мягкого матча (имя файла/листа).
  output:
    type: object
    additionalProperties: true
    required:
    - ok
resources:
  cpu: 0.3
  memory: 192
  timeout: 90
  network:
    hosts: []
---

Резолвер рабочего источника (файл + лист) перед операциями с таблицей.
По умолчанию выбирает открытую книгу Cell, а не предыдущий KPI/сводный файл.
