---
name: record_diagnosis
description: >-
  Фиксирует диагноз/совет по инциденту в diagnoses и проставляет severity + status='triaged'
  в incidents. Вызывает оркестратор по RESULT воркера.
scriptFile: record_diagnosis.js
schemas:
  input:
    type: object
    additionalProperties: false
    required:
      - rescue_id
      - incident_id
    properties:
      rescue_id:
        type: string
      incident_id:
        type: string
      verdict:
        type: string
        description: "Вердикт: survivable | needs_break | escalate | needs_review."
      severity:
        type: string
        description: "Серьёзность: low | medium | high | critical."
      advice:
        type: string
        description: Короткое резюме совета (полный разбор лежит в note_path).
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
      incident_id:
        type: string
      verdict:
        type: string
      severity:
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

Журнал диагнозов ведёт оркестратор (воркер диагнозы не пишет — возвращает их строкой RESULT).
