---
name: r7_disk_gost34_generate
description: Формирует DOCX по ГОСТ34 на основе шаблона из Р7 Диск и загружает результат в целевую папку результатов.
scriptFile: r7_disk_gost34_generate.js
schemas:
  input:
    type: object
    additionalProperties: false
    required:
      - input_directory_id
      - input_name
    properties:
      input_directory_id:
        oneOf:
          - type: integer
          - type: string
        description: ID папки в Р7 Диск, где лежит исходный файл.
      input_name:
        type: string
        description: Имя исходного файла (docx/txt/md).
      template_directory_id:
        oneOf:
          - type: integer
          - type: string
        description: ID папки с ГОСТ34-шаблонами. Можно не передавать, если задан в environment.user.
      template_name:
        type: string
        description: Имя DOCX-шаблона. По умолчанию gost34_task_description_template.docx.
      result_directory_id:
        oneOf:
          - type: integer
          - type: string
        description: ID папки, куда загрузить результат. Можно не передавать, если задан в environment.user.
      output_name:
        type: string
        description: Имя выходного файла. Если не задано, будет *_gost34_postanovka.docx.
      conflict_policy:
        type: string
        description: suffix | overwrite | error.
      projectName:
        type: string
      organization:
        type: string
      cipher:
        type: string
      auth_token:
        type: string
      base_url:
        type: string
      login:
        type: string
      password:
        type: string
  output:
    type: object
    additionalProperties: true
    required:
      - ok
      - operation
    properties:
      ok:
        type: boolean
      operation:
        type: string
      output_name:
        type: string
      output_document_id:
        type: integer
      output_size_bytes:
        type: integer
      filledSlots:
        type: integer
      missingSlots:
        type: integer
      recommendations:
        type: array
        items:
          type: string
      warnings:
        type: array
        items:
          type: string
      error:
        type: string
resources:
  cpu: 0.5
  memory: 256
  timeout: 180
  network:
    hosts:
      - cddisk.gptz.lad-soft.ru
      - cddisk.stand.lad-soft.ru
      - cddisk.r7o.ro
environment:
  user:
    R7_DISK_GOST34_TEMPLATE_DIRECTORY_ID:
      title: ID папки шаблонов ГОСТ34 в Р7 Диск
      format: number
    R7_DISK_GOST34_TEMPLATE_NAME:
      title: Имя шаблона ГОСТ34
      format: string
    R7_DISK_GOST34_RESULT_DIRECTORY_ID:
      title: ID папки результатов ГОСТ34 в Р7 Диск
      format: number
---

