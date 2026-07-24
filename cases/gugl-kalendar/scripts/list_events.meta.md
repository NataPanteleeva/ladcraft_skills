---
name: list_events
description: Список событий календаря primary за период по пресету (today,
  tomorrow, this_week, next_n_days). Требует предварительный
  google_calendar_oauth.
schemas:
  input:
    type: object
    required:
      - preset
    properties:
      days:
        type: integer
        maximum: 30
        minimum: 1
        description: Число календарных дней от начала сегодняшнего дня (только для
          next_n_days).
      preset:
        enum:
          - today
          - tomorrow
          - this_week
          - next_n_days
        type: string
        description: Период выборки; для next_n_days обязателен параметр days.
    additionalProperties: false
  output:
    type: object
    required:
      - ok
    properties:
      ok:
        type: boolean
      count:
        type: integer
      error:
        type: string
      events:
        type: array
        items:
          type: object
          properties:
            id:
              type: string
              nullable: true
            end:
              type: object
              nullable: true
            start:
              type: object
              nullable: true
            status:
              type: string
              nullable: true
            summary:
              type: string
              nullable: true
            htmlLink:
              type: string
              nullable: true
            location:
              type: string
              nullable: true
              description: Место проведения (адрес, название зала и т.д.).
            attendees:
              type: array
              items:
                type: object
                properties:
                  email:
                    type: string
                    nullable: true
                  responseStatus:
                    type: string
                    nullable: true
            recurrence:
              type: array
              items:
                type: string
              nullable: true
            description:
              type: string
              nullable: true
              description: Описание мероприятия (body события).
            conferenceLink:
              type: string
              nullable: true
              description: Ссылка на созвон (Google Meet или аналог).
      preset:
        type: string
      details:
        type: object
      timeMax:
        type: string
      timeMin:
        type: string
environment:
  app:
    GOOGLE_OAUTH_CLIENT_ID: ${GOOGLE_OAUTH_CLIENT_ID}
    GOOGLE_OAUTH_CLIENT_SECRET: ${GOOGLE_OAUTH_CLIENT_SECRET}
resources:
  cpu: 0.5
  memory: 128
  timeout: 60
  network:
    hosts:
      - www.googleapis.com
      - oauth2.googleapis.com
---


