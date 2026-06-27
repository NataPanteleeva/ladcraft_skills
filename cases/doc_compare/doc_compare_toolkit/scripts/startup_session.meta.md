---
name: startup_session
description: Старт сессии — resolve R7 snapshot и список шаблонов Templates; возвращает greeting_markdown для первого ответа.
scriptFile: startup_session.js
schemas:
  input:
    type: object
    additionalProperties: false
    properties:
      session_file:
        type: string
        description: Path из mentioned.files[0].file_name.
      doc_key:
        type: string
        description: Опционально, из title чата R7.
      retries:
        type: integer
      wait_ms:
        type: integer
  output:
    type: object
    additionalProperties: false
    required:
      - ok
      - greeting_markdown
      - session_file
      - templates
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
  timeout: 60
  network:
    hosts: []
---
