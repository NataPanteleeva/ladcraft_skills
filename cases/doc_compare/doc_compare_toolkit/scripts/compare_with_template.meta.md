---
name: compare_with_template
description: Сравнивает загруженный документ с выбранным шаблоном и возвращает отчёт в формате Markdown.
scriptFile: compare_with_template.js
schemas:
  input:
    type: object
    additionalProperties: false
    required:
      - template_name
    properties:
      template_name:
        type: string
        description: Имя файла шаблона из папки Templates (как в list_templates).
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
      template_name:
        type: string
      template_path:
        type: string
      report_markdown:
        type: string
resources:
  cpu: 0.2
  memory: 256
  timeout: 60
  network:
    hosts: []
---
