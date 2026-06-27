---
name: start_rescue
description: >-
  Создаёт сессию спасения и регистрирует набор инцидентов (decompose): пишет строки
  в rescue_session и incidents, сохраняет крик души в /user/burnout/{rescue_id}/complaint.json
  и возвращает rescue_id и детерминированные note_path. Идемпотентно создаёт схему.
scriptFile: start_rescue.js
schemas:
  input:
    type: object
    additionalProperties: false
    required:
      - incidents
    properties:
      dev_name:
        type: string
        description: Имя/ник разработчика.
      vibe:
        type: string
        description: Короткое описание общего настроя ("всё сломалось", "горит дедлайн").
      fatigue:
        type: number
        description: Уровень усталости 0..100.
      caffeine:
        type: number
        description: Уровень кофеина в крови 0..100.
      complaint:
        type: object
        description: >-
          Канонический крик души (raw-текст и контекст). Пишется один раз в complaint.json;
          воркеры читают его через get_complaint — без дрейфа контекста.
      incidents:
        type: array
        description: Упорядоченный набор инцидентов (страданий) после декомпозиции крика.
        items:
          type: object
          additionalProperties: false
          properties:
            incident_id:
              type: string
              description: Идентификатор инцидента (например merge_hell, impostor).
            kind:
              type: string
              description: "Тип: bug | legacy | deadline | impostor_syndrome | meeting_overload | merge_hell | misc."
            title:
              type: string
              description: Заголовок инцидента.
            ord:
              type: number
              description: Порядковый номер (если не задан — по позиции).
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
      dev_name:
        type: string
      fatigue:
        type: number
      caffeine:
        type: number
      complaint_path:
        type: string
        description: Путь к записанному complaint.json (пусто, если complaint не передан).
      incidents:
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

Регистрирует сессию спасения в журнале (sql-storage) и возвращает план инцидентов с путями разборов.
