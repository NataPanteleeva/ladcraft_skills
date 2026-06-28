---
name: prepare_compare
description: >-
  Читает эталон (Templates) и snapshot R7 параллельно. Один вызов перед LLM-сравнением.
scriptFile: prepare_compare.js
schemas:
  input:
    type: object
    additionalProperties: false
    properties:
      template_name:
        type: string
        description: Имя шаблона, например ТТ_десктоп.md
      session_file:
        type: string
        description: Канонический path из startup_compare
      doc_key:
        type: string
        description: docKey word:… (опционально)
      limit_chars:
        type: integer
        description: Лимит символов body.text документа B (по умолчанию 140000)
      template_limit_chars:
        type: integer
        description: Лимит символов шаблона A (по умолчанию 150000)
  output:
    type: object
    additionalProperties: true
    required:
      - ok
      - session_file
      - template_name
      - template_text
      - document_text
    properties:
      ok:
        type: boolean
      reason:
        type: string
      error:
        type: string
      session_file:
        type: string
      doc_key:
        type: string
      template_name:
        type: string
      template_path:
        type: string
      template_text:
        type: string
      document_text:
        type: string
      document_meta:
        type: object
resources:
  cpu: 0.3
  memory: 256
  timeout: 45
  network:
    hosts: []
---
