---
name: r7_search_replace
description: SearchAndReplace в открытом документе R7.
scriptFile: r7_search_replace.js
resources:
  timeout: 30
  cpu: 0.2
  memory: 128
schemas:
  input:
    type: object
    additionalProperties: true
    properties:
      search:
        type: string
        description: Что искать
      replace:
        type: string
        description: На что заменить
      matchCase:
        type: boolean
        description: Учитывать регистр
    required:
      - search
      - replace
  output:
    type: object
    additionalProperties: true
    required:
      - ok
    properties:
      ok:
        type: boolean
      error:
        type: string
auth: null
---
