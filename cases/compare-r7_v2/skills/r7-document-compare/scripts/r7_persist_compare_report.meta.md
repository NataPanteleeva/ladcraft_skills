---
name: r7_persist_compare_report
description: >-
  Сохраняет slim CompareReport в /session/compare/latest.json для EXPORT.
scriptFile: r7_persist_compare_report.js
schemas:
  input:
    type: object
    additionalProperties: true
    properties:
      report:
        type: object
        description: Slim CompareReport (без chatMarkdown).
        additionalProperties: true
      path:
        type: string
        description: 'По умолчанию /session/compare/latest.json'
  output:
    type: object
    additionalProperties: true
    required:
      - ok
    properties:
      ok:
        type: boolean
      path:
        type: string
      error:
        type: string
capabilities:
  required:
    - type: vfs
      scope: session
      operations:
        - writeFile
resources:
  cpu: 0.1
  memory: 64
  timeout: 60
  network:
    hosts: []
---
