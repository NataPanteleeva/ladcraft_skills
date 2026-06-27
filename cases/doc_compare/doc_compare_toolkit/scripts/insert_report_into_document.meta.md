---
name: insert_report_into_document
description: >-
  Сохраняет отчёт сравнения в /workspace/ для вставки в документ R7 (не изменяет r7-snapshot JSON
  в /session/). Для вставки в Word используйте r7-export после этого tool.
scriptFile: insert_report_into_document.js
schemas:
  input:
    type: object
    additionalProperties: false
    required:
      - session_file
      - report_markdown
    properties:
      session_file:
        type: string
        description: Bash-path к r7-snapshot в /session/r7/ (из list_session_files или mentioned.files).
      report_markdown:
        type: string
        description: Текст отчёта сравнения.
  output:
    type: object
    additionalProperties: false
    required:
      - ok
    properties:
      ok:
        type: boolean
      error:
        type: string
      session_file:
        type: string
      workspace_report_path:
        type: string
      file_name:
        type: string
      note:
        type: string
resources:
  cpu: 0.2
  memory: 128
  timeout: 30
  network:
    hosts: []
---
