---
name: load_compare_pair
description: >-
  НЕ ПУБЛИКУЕТСЯ (ADR-001): skill VFS на /session/r7/ зависает на prod.
  Канон COMPARE — agent bash head A+B. Код оставлен для будущего smoke.
scriptFile: load_compare_pair.js
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
        description: Полный path из mentioned.files[0].file_name
      doc_key:
        type: string
        description: docKey word:… (опционально)
      limit_chars:
        type: integer
        description: Лимит символов document_text (по умолчанию 200000)
      template_limit_chars:
        type: integer
        description: Лимит символов template_text (по умолчанию 150000)
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
      template_chars:
        type: integer
      document_chars:
        type: integer
      body_length:
        type: integer
      truncated:
        type: object
      warnings:
        type: array
      bash_fallback_hint:
        type: string
      document_meta:
        type: object
resources:
  cpu: 0.3
  memory: 256
  timeout: 15
  network:
    hosts: []
---
