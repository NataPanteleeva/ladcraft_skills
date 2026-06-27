---
name: compose_rescue_plan
description: >-
  Собирает «План спасения» из разборов инцидентов по порядку (читает по note_path из журнала)
  и пишет rescue_plan.md + pep_talk.md в /workspace/burnout/{rescue_id}/ (видно пользователю).
scriptFile: compose_rescue_plan.js
schemas:
  input:
    type: object
    additionalProperties: false
    required:
      - rescue_id
    properties:
      rescue_id:
        type: string
      header:
        type: string
        description: Заголовок/преамбула плана (по умолчанию "# План спасения разработчика").
      incidents:
        type: array
        description: Опциональный явный порядок инцидентов; если пуст — берётся из журнала.
        items:
          type: object
      pep_talk_text:
        type: string
        description: Мотивационный текст (pep talk); если задан — пишется в pep_talk.md.
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
      document_path:
        type: string
      pep_talk_path:
        type: string
      incidents_used:
        type: number
      missing_incidents:
        type: array
        items:
          type: string
      error:
        type: string
resources:
  cpu: 0.2
  memory: 128
  timeout: 60
  network:
    hosts: []
---

Финальная сборка: читает разборы из /user, пишет результат в /workspace (виден пользователю).
