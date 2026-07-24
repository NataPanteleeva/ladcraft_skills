---
name: r7_show_compare_actions_widget
description: Виджет с кнопками действий после отчёта сравнения (вставить, скачать md/html, сохранить на диск).
scriptFile: r7_show_compare_actions_widget.js
schemas:
  input:
    type: object
    additionalProperties: false
    properties: {}
  output:
    type: object
    additionalProperties: false
    required:
      - ok
      - show_widget
    properties:
      ok:
        type: boolean
      show_widget:
        type: boolean
auth: null
capabilities:
  required: []
resources:
  cpu: 0.1
  memory: 64
  timeout: 30
  network:
    hosts: []
---
