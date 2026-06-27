---
name: primer
description: Минимальный approved tool без VFS и widget (native handler).
scriptFile: primer.js
schemas:
  input:
    type: object
    additionalProperties: false
    required:
      - message
    properties:
      message:
        type: string
        description: Сообщение, которое tool вернёт обратно.
  output:
    type: object
    additionalProperties: false
    required:
      - ok
      - message
    properties:
      ok:
        type: boolean
      message:
        type: string
resources:
  cpu: 0.2
  memory: 128
  timeout: 30
  network:
    hosts: []
---

Approved minimal meta. `environment` не задаётся здесь: если он нужен, объявляйте его в `SKILL.md -> mcp_spec.tools[]`.
