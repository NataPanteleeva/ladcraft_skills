---
name: showStatusCard
description: Возвращает данные для EJS widget `statusCard`.
scriptFile: showStatusCard.js
schemas:
  input:
    type: object
    additionalProperties: false
    required:
      - title
      - message
    properties:
      title:
        type: string
      message:
        type: string
  output:
    type: object
    additionalProperties: false
    required:
      - title
      - message
      - docsUrl
    properties:
      title:
        type: string
      message:
        type: string
      docsUrl:
        type: string
resources:
  cpu: 0.2
  memory: 128
  timeout: 30
  network:
    hosts:
      - cdn.tailwindcss.com
      - example.com
---

Approved widget meta. Если шаблон использует внешний хост, он обязан быть указан в `resources.network.hosts`.
