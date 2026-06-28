---
name: read_r7_snapshot_text
description: >-
  Читает body.text из r7-snapshot в session VFS через skill readFile (source original).
  Надёжная альтернатива bash head/python на /session/r7/.
scriptFile: read_r7_snapshot_text.js
schemas:
  input:
    type: object
    additionalProperties: false
    properties:
      session_file:
        type: string
        description: Полный path из mentioned.files или startup_compare, например /session/r7/r7-word_….json
      limit_chars:
        type: integer
        description: Макс. символов body.text в ответе (по умолчанию 80000, макс. 300000).
  output:
    type: object
    additionalProperties: true
    required:
      - ok
      - session_file
      - text
    properties:
      ok:
        type: boolean
      reason:
        type: string
      error:
        type: string
      session_file:
        type: string
      schema:
        type: string
      text:
        type: string
      body_length:
        type: integer
      bytes_read:
        type: integer
      truncated:
        type: boolean
      limit_chars:
        type: integer
resources:
  cpu: 0.2
  memory: 256
  timeout: 35
  network:
    hosts: []
---
