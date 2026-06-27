---
name: getConfiguredGreeting
description: Возвращает приветствие на основе `environment.user.GREETING_PREFIX`.
scriptFile: getConfiguredGreeting.js
schemas:
  input:
    type: object
    additionalProperties: false
    properties:
      name:
        type: string
  output:
    type: object
    additionalProperties: false
    required:
      - ok
      - greeting
    properties:
      ok:
        type: boolean
      greeting:
        type: string
resources:
  cpu: 0.2
  memory: 128
  timeout: 30
  network:
    hosts: []
---

Approved env example. В этом шаблоне user env объявлен в `SKILL.md` как fallback/shared-config; в реальных навыках допустим и `scripts/*.meta.md -> environment.user`, если итоговый publish payload предсказуем.
