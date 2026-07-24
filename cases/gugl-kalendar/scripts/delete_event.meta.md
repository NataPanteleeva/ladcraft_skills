---
name: delete_event
description: Удаляет событие из primary календаря по eventId. При 404/410
  возвращает предупреждение, что событие уже удалено или не найдено.
schemas:
  input:
    type: object
    required:
      - eventId
    properties:
      eventId:
        type: string
        description: ID события в Google Calendar.
    additionalProperties: false
  output:
    type: object
    required:
      - ok
    properties:
      ok:
        type: boolean
      deleted:
        type: boolean
      error:
        type: string
      warning:
        type: string
      details:
        type: object
      eventId:
        type: string
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


