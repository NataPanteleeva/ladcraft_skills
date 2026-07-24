---
name: create_event
description: "Создаёт событие в primary: FreeBusy для организатора и участников
  (email), затем insert. При конфликтах событие всё равно создаётся; в ответе
  conflicts и warnings."
schemas:
  input:
    type: object
    required:
      - summary
      - startDateTime
    properties:
      summary:
        type: string
        description: Заголовок встречи.
      attendees:
        type: array
        items:
          type: string
        description: Email участников для приглашения и для FreeBusy.
      endDateTime:
        type: string
        description: Конец в ISO 8601; альтернатива durationMinutes.
      startDateTime:
        type: string
        description: Начало в ISO 8601 (date-time).
      durationMinutes:
        type: integer
        maximum: 1440
        minimum: 1
        description: Длительность в минутах от startDateTime, если нет endDateTime.
      timeZone:
        type: string
        description: IANA timezone (например Europe/Moscow). Если не задан — выводится из
          offset в startDateTime (+03:00 → Europe/Moscow). Для recurrence обязателен
          явный timeZone в теле события.
      recurrence:
        type: array
        items:
          type: string
        description: График повторений (RRULE/RDATE/EXRULE/EXDATE), например
          ["RRULE:FREQ=WEEKLY;BYDAY=MO,WE,FR"].
    additionalProperties: false
  output:
    type: object
    required:
      - ok
    properties:
      ok:
        type: boolean
      error:
        type: string
      details:
        type: object
      warnings:
        type: array
        items:
          type: object
      conflicts:
        type: array
        items:
          type: object
      createdEvent:
        type: object
environment:
  app:
    GOOGLE_OAUTH_CLIENT_ID: ${GOOGLE_OAUTH_CLIENT_ID}
    GOOGLE_OAUTH_CLIENT_SECRET: ${GOOGLE_OAUTH_CLIENT_SECRET}
resources:
  cpu: 0.5
  memory: 256
  timeout: 60
  network:
    hosts:
      - www.googleapis.com
      - oauth2.googleapis.com
---


