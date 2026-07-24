---
name: filter_export
description: >-
  Фильтр строк → /session/*_filter.xlsx. ОБЯЗАТЕЛЬНО filters:
  [{field:"Город", op:"eq", value:"Москва"}]. Без filters вызов отвергается.
  op: eq|ne|contains|in|month|year_month|gt|gte|lt|lte|empty|not_empty.
  targetPath не передавай. После ok: stop+userReply.
runtime: python@3
scriptFile: filter_export.py
schemas:
  input:
    type: object
    additionalProperties: false
    required:
      - sourcePath
      - filters
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
      filters:
        type: array
        description: "Обязателен. Пример для Москвы: [{field:Город, op:eq, value:Москва}]"
        items:
          type: object
          additionalProperties: true
      matchAny:
        type: boolean
      columns:
        type: array
        items:
          type: string
        description: Не обязателен. Без columns — все колонки источника.
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

Фильтрация таблицы в новый xlsx (все колонки по умолчанию).
