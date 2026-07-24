---
name: startup_compare
description: >-
  Один вызов на старт сессии: resolve R7 snapshot + список шаблонов Templates + готовый greeting_markdown.
scriptFile: startup_compare.js
schemas:
  input:
    type: object
    additionalProperties: false
    properties:
      session_file:
        type: string
        description: Path из mentioned.files[0].file_name
      doc_key:
        type: string
        description: docKey из title чата R7 (word:…)
      retries:
        type: integer
      wait_ms:
        type: integer
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
      session_file:
        type: string
      doc_key:
        type: string
      document:
        type: object
      templates:
        type: object
resources:
  cpu: 0.2
  memory: 128
  timeout: 90
  network:
    hosts: []
---
