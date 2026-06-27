---
name: save_advice
description: >-
  (воркер) Записывает разбор инцидента (markdown) по точному path в общий слой
  /user/burnout/{rescue_id}/notes/{incident_id}.md. Реальная запись в VFS.
scriptFile: save_advice.js
schemas:
  input:
    type: object
    additionalProperties: false
    required:
      - text
    properties:
      rescue_id:
        type: string
      incident_id:
        type: string
      path:
        type: string
        description: Точный путь note_path из start_rescue (приоритетнее rescue_id+incident_id).
      text:
        type: string
        description: Текст разбора инцидента в markdown.
  output:
    type: object
    additionalProperties: false
    required:
      - ok
    properties:
      ok:
        type: boolean
      incident_id:
        type: string
      path:
        type: string
      length:
        type: number
      error:
        type: string
resources:
  cpu: 0.2
  memory: 128
  timeout: 60
  network:
    hosts: []
---

Пишет разбор инцидента в общий слой /user (межагентский обмен); оркестратор соберёт план по note_path.
