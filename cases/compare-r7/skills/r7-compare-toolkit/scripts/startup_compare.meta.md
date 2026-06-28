---
name: startup_compare
description: >-
  Старт: список Templates + greeting_markdown (без чтения snapshot).
scriptFile: startup_compare.js
schemas:
  input:
    type: object
    additionalProperties: false
    properties:
      session_file:
        type: string
        description: Полный path из mentioned.files[0].file_name
      doc_key:
        type: string
  output:
    type: object
    additionalProperties: true
    required:
      - ok
      - greeting_markdown
    properties:
      ok:
        type: boolean
      greeting_markdown:
        type: string
      found:
        type: boolean
      session_file:
        type: string
      doc_key:
        type: string
resources:
  cpu: 0.2
  memory: 128
  timeout: 10
  network:
    hosts: []
---
