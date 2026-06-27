---
name: check_notes
description: >-
  (оркестратор) По факту наличия файлов разборов возвращает present/missing инциденты.
  Источник истины для анти-зацикливания: переделывать только missing. Только чтение.
scriptFile: check_notes.js
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
      total:
        type: number
      present:
        type: array
        items:
          type: string
      missing:
        type: array
        items:
          type: string
      complete:
        type: boolean
      error:
        type: string
resources:
  cpu: 0.2
  memory: 128
  timeout: 60
  network:
    hosts: []
---

Готовность инцидентов определяется фактом файлов разборов в /user, а не строками RESULT воркера.
