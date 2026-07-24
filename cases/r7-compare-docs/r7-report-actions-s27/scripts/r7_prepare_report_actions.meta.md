---
name: r7_prepare_report_actions
description: Готовит r7.task для вставки markdown-отчёта и/или скачивания .md/.html в плагине ladcraft-r7.
scriptFile: r7_prepare_report_actions.js
schemas:
  input:
    type: object
    additionalProperties: false
    required:
      - markdown
      - mode
    properties:
      markdown:
        type: string
        description: Финальный markdown-отчёт сравнения.
      mode:
        type: string
        enum:
          - insert
          - download_md
          - both
          - download_html
      fileName:
        type: string
        description: Имя файла для deliver_inline (.md / .html).
  output:
    type: object
    additionalProperties: true
    required:
      - ok
    properties:
      ok:
        type: boolean
      mode:
        type: string
      fileName:
        type: string
      r7_task:
        type: array
      r7_task_block:
        type: string
      error:
        type: string
      agent_message:
        type: string
auth: null
capabilities:
  required: []
resources:
  cpu: 0.2
  memory: 128
  timeout: 60
  network:
    hosts: []
---
