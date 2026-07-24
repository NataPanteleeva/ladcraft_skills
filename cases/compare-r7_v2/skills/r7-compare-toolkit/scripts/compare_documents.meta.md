---
name: compare_documents
description: >-
  Атомарное сравнение: читает шаблон Templates и r7-snapshot, строит CompareReport,
  chat_markdown и r7.task без передачи сырых текстов в контекст агента.
scriptFile: compare_documents.js
schemas:
  input:
    type: object
    additionalProperties: false
    required:
      - template_name
      - session_file
    properties:
      template_name:
        type: string
        description: Имя шаблона в /workspace/Templates/, например ТТ_десктоп.md
      session_file:
        type: string
        description: Path snapshot из startup_compare / mentioned.files
      max_chat_rows:
        type: integer
        description: Макс. строк расхождений в chat_markdown (по умолчанию 20, макс. 50)
  output:
    type: object
    additionalProperties: true
    required:
      - ok
    properties:
      ok:
        type: boolean
      error:
        type: string
      compare_report:
        type: object
      chat_markdown:
        type: string
      r7_task_block:
        type: string
      stats:
        type: object
      session_file:
        type: string
      template_path:
        type: string
resources:
  cpu: 0.3
  memory: 256
  timeout: 180
  network:
    hosts: []
---
