---
name: list_workbooks
description: >-
  Ищет Excel-файлы (.xlsx/.xlsm/.xls) в /session/r7, /session и /workspace;
  возвращает список путей и preferred (единственный файл плагина под /session/r7).
runtime: python@3
scriptFile: list_workbooks.py
schemas:
  input:
    type: object
    additionalProperties: false
    properties:
      roots:
        type: array
        description: "Корни поиска. По умолчанию [\"/session/r7\", \"/session\", \"/workspace\"]."
        items:
          type: string
  output:
    type: object
    additionalProperties: false
    required:
      - ok
      - files
      - count
    properties:
      ok:
        type: boolean
      error:
        type: string
      files:
        type: array
        items:
          type: object
          additionalProperties: false
          properties:
            path:
              type: string
            name:
              type: string
            root:
              type: string
      count:
        type: number
      preferred:
        type: string
        description: >-
          Единственный .xlsx под /session/r7 (плагин R7), иначе отсутствует/null.
          Агент может взять его без выбора пользователя.
resources:
  cpu: 0.2
  memory: 128
  timeout: 60
  network:
    hosts: []
---

Список Excel-файлов в VFS для агента сводных таблиц.
