---
name: save_report_for_download
description: Сохраняет отчёт сравнения в рабочую область агента для скачивания пользователем.
scriptFile: save_report_for_download.js
schemas:
  input:
    type: object
    additionalProperties: false
    required:
      - report_markdown
    properties:
      report_markdown:
        type: string
        description: Текст отчёта сравнения.
      file_name:
        type: string
        description: Имя файла для скачивания (по умолчанию otchet_sravneniya.md).
  output:
    type: object
    additionalProperties: false
    required:
      - ok
    properties:
      ok:
        type: boolean
      error:
        type: string
      download_path:
        type: string
      file_name:
        type: string
resources:
  cpu: 0.2
  memory: 128
  timeout: 30
  network:
    hosts: []
---
