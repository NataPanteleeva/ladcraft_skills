---
name: list_session_files
description: >-
  Список r7-snapshot и других json в /session/r7/ и /session/. Поддерживает retries/wait_ms
  при гонке upload плагина и первого сообщения.
scriptFile: list_session_files.js
schemas:
  input:
    type: object
    additionalProperties: false
    properties:
      retries:
        type: integer
        description: Число попыток (по умолчанию 1, макс. 8).
      wait_ms:
        type: integer
        description: Пауза между попытками в мс (по умолчанию 0).
  output:
    type: object
    additionalProperties: false
    required:
      - ok
      - files
      - count
    properties:
      ok:
        type: boolean
      error:
        type: string
      files:
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
            kind:
              type: string
      count:
        type: integer
      attempts:
        type: integer
resources:
  cpu: 0.2
  memory: 128
  timeout: 90
  network:
    hosts: []
---
