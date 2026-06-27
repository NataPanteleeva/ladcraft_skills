---
name: log_incident
description: Добавляет один инцидент в журнал спасения (incidents) и возвращает его note_path.
scriptFile: log_incident.js
schemas:
  input:
    type: object
    additionalProperties: false
    required:
      - rescue_id
    properties:
      rescue_id:
        type: string
      incident_id:
        type: string
        description: Идентификатор инцидента (если не задан — генерируется из title).
      kind:
        type: string
        description: "Тип инцидента: bug | legacy | deadline | impostor_syndrome | meeting_overload | merge_hell | misc."
      title:
        type: string
      ord:
        type: number
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
      kind:
        type: string
      title:
        type: string
      note_path:
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

Регистрирует отдельный инцидент в sql-storage (используется для добивания после декомпозиции).
