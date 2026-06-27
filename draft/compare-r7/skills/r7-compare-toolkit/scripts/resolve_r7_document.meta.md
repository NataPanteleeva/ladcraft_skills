---
name: resolve_r7_document
description: >-
  Находит r7-snapshot в session VFS: по session_file (mentioned.files), doc_key (из title чата
  R7: word:…) или сканированию /session/r7/. Повторяет попытки при гонке upload/message.
scriptFile: resolve_r7_document.js
schemas:
  input:
    type: object
    additionalProperties: false
    properties:
      session_file:
        type: string
        description: Полный path из mentioned.files[0].file_name, например /session/r7/r7-word_….json
      doc_key:
        type: string
        description: docKey из title чата, например word:7b6db4c8d218664ebb84
      retries:
        type: integer
        description: Число попыток (по умолчанию 3, макс. 8).
      wait_ms:
        type: integer
        description: Пауза между попытками в мс (по умолчанию 2000, макс. 10000).
  output:
    type: object
    additionalProperties: false
    required:
      - ok
      - found
      - attempts
    properties:
      ok:
        type: boolean
      found:
        type: boolean
      error:
        type: string
      session_file:
        type: string
      doc_key:
        type: string
      attempts:
        type: integer
      source:
        type: string
      reason:
        type: string
      body_length:
        type: integer
      candidates:
        type: array
        items:
          type: string
      files:
        type: array
      hint:
        type: string
resources:
  cpu: 0.2
  memory: 128
  timeout: 90
  network:
    hosts: []
---
