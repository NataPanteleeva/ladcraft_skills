---
name: get_survival_tip
description: >-
  Возвращает совет дня по теме с учётом install-time конфига environment.user
  (TOXICITY_LEVEL задаёт тон, DEV_NAME — имя по умолчанию). Без побочных эффектов.
scriptFile: get_survival_tip.js
schemas:
  input:
    type: object
    additionalProperties: false
    properties:
      topic:
        type: string
        description: "Тема: general | bug | legacy | deadline | impostor_syndrome | meeting_overload | merge_hell."
      dev_name:
        type: string
        description: Имя разработчика (перекрывает environment.user.DEV_NAME).
  output:
    type: object
    additionalProperties: false
    required:
      - ok
      - tip
    properties:
      ok:
        type: boolean
      topic:
        type: string
      tone:
        type: string
      tip:
        type: string
resources:
  cpu: 0.2
  memory: 128
  timeout: 30
  network:
    hosts: []
---

Конфиг тона объявлен в SKILL.md (mcp_spec.tools[].environment.user), не в meta — это install-time настройка.
