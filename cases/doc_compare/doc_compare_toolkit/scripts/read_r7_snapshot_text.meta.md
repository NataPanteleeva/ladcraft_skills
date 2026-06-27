---
name: read_r7_snapshot_text
description: >-
  Читает body.text из r7-snapshot в session VFS через skill readFile (source original).
scriptFile: read_r7_snapshot_text.js
schemas:
  input:
    type: object
    additionalProperties: false
    properties:
      session_file:
        type: string
      limit_chars:
        type: integer
  output:
    type: object
    additionalProperties: true
resources:
  cpu: 0.2
  memory: 256
  timeout: 120
  network:
    hosts: []
---
