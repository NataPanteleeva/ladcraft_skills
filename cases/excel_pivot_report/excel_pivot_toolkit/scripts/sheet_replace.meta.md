---
name: sheet_replace
description: >-
  ОТКЛЮЧЁН. Перезапись открытого листа — кнопка «Заменить» в плагине.
  Всегда возвращает ok:false. Не вызывай после sort/filter/pivot.
runtime: python@3
scriptFile: sheet_replace.py
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
      mode:
        type: string
      range:
        type: string
      clearTarget:
        type: boolean
  output:
    type: object
    additionalProperties: true
    required:
      - ok
resources:
  cpu: 0.2
  memory: 128
  timeout: 30
  network:
    hosts: []
---
