---
name: update_event
description: Обновляет событие в primary календаре по eventId. Поддерживает
  patch-обновление summary, start/end, attendees, location, description,
  recurrence.
schemas:
  input:
    type: object
    required:
      - eventId
    properties:
      eventId:
        type: string
        description: ID события в Google Calendar.
      summary:
        type: string
        description: Новый заголовок встречи.
      startDateTime:
        type: string
        description: Новое начало в ISO 8601.
      endDateTime:
        type: string
        description: Новый конец в ISO 8601.
      attendees:
        type: array
        items:
          type: string
        description: Новый список email участников.
      location:
        type: string
        description: Место встречи.
      description:
        type: string
        description: Описание события.
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
      updatedEvent:
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


