---
name: google_calendar_oauth
description: "OAuth 2.0 Google для Calendar API: редирект, callback, обмен code
  на токены и сохранение в user key-value storage (секреты в ответ не
  попадают)."
schemas:
  input:
    type: object
    properties: {}
  output:
    type: object
    required:
      - ok
    properties:
      ok:
        type: boolean
      error:
        type: string
      status:
        type: string
      details:
        type: object
      message:
        type: string
      refresh_token_saved:
        type: boolean
environment:
  app:
    GOOGLE_OAUTH_CLIENT_ID: ${GOOGLE_OAUTH_CLIENT_ID}
    GOOGLE_OAUTH_CLIENT_SECRET: ${GOOGLE_OAUTH_CLIENT_SECRET}
resources:
  cpu: 0.5
  memory: 256
  timeout: 180
  network:
    hosts:
      - accounts.google.com
      - oauth2.googleapis.com
      - www.googleapis.com
---


