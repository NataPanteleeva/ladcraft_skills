---
name: normalizeLead
description: Нормализует lead-данные через helper-функции из SKILL.md -> general.lib[].
scriptFile: normalizeLead.js
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
      - lead
      - summary
    properties:
      ok:
        type: boolean
      lead:
        type: object
        additionalProperties: false
        required:
          - name
          - email
        properties:
          name:
            type: string
          email:
            type: string
      summary:
        type: string
resources:
  cpu: 0.2
  memory: 128
  timeout: 30
  network:
    hosts: []
---

Tool вызывает helper-функции из `general.lib[]` напрямую, без imports.
