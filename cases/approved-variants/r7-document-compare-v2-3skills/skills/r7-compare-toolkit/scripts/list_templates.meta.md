---
name: list_templates
description: Возвращает список шаблонов из папки Templates рабочей области агента.
scriptFile: list_templates.js
schemas:
  input:
    type: object
    additionalProperties: false
    properties:
      _unused:
        type: string
        description: Не используется.
  output:
    type: object
    additionalProperties: false
    required:
      - ok
      - templates
      - count
    properties:
      ok:
        type: boolean
      error:
        type: string
      templates:
        type: array
        items:
          type: object
          additionalProperties: false
          required:
            - name
            - path
          properties:
            name:
              type: string
            path:
              type: string
      count:
        type: integer
      templates_dir:
        type: string
resources:
  cpu: 0.2
  memory: 128
  timeout: 30
  network:
    hosts: []
---
