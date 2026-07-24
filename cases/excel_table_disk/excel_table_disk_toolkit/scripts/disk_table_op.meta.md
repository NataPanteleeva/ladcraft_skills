---
name: disk_table_op
description: >-
  Скачивает .xlsx с Р7-Диска по document_id, выполняет operation
  (profile|filter|pivot|top_n|compare) и загружает результат обратно на диск.
runtime: python@3
scriptFile: disk_table_op.py
schemas:
  input:
    type: object
    additionalProperties: false
    required:
      - operation
    properties:
      operation:
        type: string
      document_id:
        oneOf:
          - type: integer
          - type: string
      document_id_a:
        oneOf:
          - type: integer
          - type: string
      document_id_b:
        oneOf:
          - type: integer
          - type: string
      directory_id:
        oneOf:
          - type: integer
          - type: string
      output_directory_id:
        oneOf:
          - type: integer
          - type: string
      output_name:
        type: string
      conflict_policy:
        type: string
      sourceSheet:
        type: string
      sheetA:
        type: string
      sheetB:
        type: string
      keyFields:
        type: array
        items:
          type: string
      filters:
        type: array
        items:
          type: object
          additionalProperties: true
      rowFields:
        type: array
        items:
          type: string
      columnFields:
        type: array
        items:
          type: string
      valueField:
        type: string
      aggregation:
        type: string
      categoryField:
        type: string
      topN:
        type: number
  output:
    type: object
    additionalProperties: true
    required:
      - ok
resources:
  cpu: 0.5
  memory: 256
  timeout: 180
  network:
    hosts:
      - cddisk.gptz.lad-soft.ru
      - cddisk.stand.lad-soft.ru
      - cddisk.r7o.ro
---

Операции над Excel на Р7-Диске.
