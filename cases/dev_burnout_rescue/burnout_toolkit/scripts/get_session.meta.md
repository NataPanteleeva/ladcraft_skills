---
name: get_session
description: Читает сессию спасения, инциденты и диагнозы из sql-storage (обзор/recovery). Только чтение.
scriptFile: get_session.js
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
      session:
        type: object
      incidents:
        type: array
        items:
          type: object
      diagnoses:
        type: array
        items:
          type: object
      error:
        type: string
resources:
  cpu: 0.2
  memory: 128
  timeout: 60
  network:
    hosts: []
---

Сводка по сессии спасения из журнала (sql-storage). Источник истины перед сборкой плана.
