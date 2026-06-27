---
name: get_complaint
description: >-
  (воркер) Читает канонический крик души из /user/burnout/{rescue_id}/complaint.json.
  Одни и те же данные на каждый инцидент — без дрейфа контекста. Только чтение.
scriptFile: get_complaint.js
schemas:
  input:
    type: object
    additionalProperties: false
    required:
      - rescue_id
    properties:
      rescue_id:
        type: string
  output:
    type: object
    additionalProperties: false
    required:
      - ok
    properties:
      ok:
        type: boolean
      rescue_id:
        type: string
      complaint_path:
        type: string
      complaint:
        type: object
      raw:
        type: string
        description: Сырой текст, если complaint.json не распарсился как JSON.
      error:
        type: string
resources:
  cpu: 0.2
  memory: 128
  timeout: 60
  network:
    hosts: []
---

Канонический вход (крик души) для воркера: читается из общего слоя /user, не пересказывается в задаче.
