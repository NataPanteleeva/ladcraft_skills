---
name: renderLead
description: Формирует строку lead summary через helper из SKILL.md -> general.lib[].
scriptFile: renderLead.js
schemas:
  input:
    type: object
    additionalProperties: false
    required:
      - name
    properties:
      name:
        type: string
        description: Имя lead.
      email:
        type: string
        description: Email lead.
  output:
    type: object
    additionalProperties: false
    required:
      - ok
      - summary
    properties:
      ok:
        type: boolean
      summary:
        type: string
resources:
  cpu: 0.2
  memory: 128
  timeout: 30
  network:
    hosts: []
---

В этом tool нет `require("./...")`: helper доступен через prepended `general.lib[]`.
