---
name: show_burnout_card
description: Возвращает данные для EJS widget `burnoutCard` (усталость, кофеин, прогресс спасения, статус).
scriptFile: show_burnout_card.js
schemas:
  input:
    type: object
    additionalProperties: false
    properties:
      dev_name:
        type: string
      fatigue:
        type: number
        description: Уровень усталости 0..100.
      caffeine:
        type: number
        description: Уровень кофеина 0..100.
      resolved:
        type: number
        description: Сколько инцидентов разобрано.
      total:
        type: number
        description: Всего инцидентов.
  output:
    type: object
    additionalProperties: false
    required:
      - title
      - status
    properties:
      title:
        type: string
      devName:
        type: string
      fatigue:
        type: number
      caffeine:
        type: number
      resolved:
        type: number
      total:
        type: number
      progressPct:
        type: number
      status:
        type: string
      emoji:
        type: string
      caffeineNote:
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

Widget-инструмент: данные для карточки состояния. Агент не вызывает дополнительные platform tools для рендера.
