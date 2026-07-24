---
name: build_pivot_table
description: >-
  Строит сводную таблицу по данным sourcePath и записывает её на лист targetSheet
  в книге targetPath (существующие листы сохраняются; при отсутствии файла
  создаётся новая книга). Реальный side effect — vfs.writeFile.
runtime: python@3
scriptFile: build_pivot_table.py
schemas:
  input:
    type: object
    additionalProperties: false
    required:
      - sourcePath
      - rowFields
      - valueField
    properties:
      sourcePath:
        type: string
        description: Путь к исходной книге с данными
      sourceSheet:
        type: string
        description: Лист с данными (по умолчанию первый)
      targetPath:
        type: string
        description: Игнорируется. Навык пишет /session/*_pivot.xlsx.
      targetSheet:
        type: string
        description: Имя листа сводной (по умолчанию Сводная)
      rowFields:
        type: array
        description: Поля строк сводной
        items:
          type: string
      columnFields:
        type: array
        description: Поля столбцов (используется первое; можно [])
        items:
          type: string
      valueField:
        type: string
        description: Поле меры
      aggregation:
        type: string
        description: "sum | count | avg | min | max"
      previewRows:
        type: number
        description: Сколько строк preview вернуть (1..30, по умолчанию 10)
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
      sourcePath:
        type: string
      targetPath:
        type: string
      targetSheet:
        type: string
      writeMode:
        type: string
      expectedBytes:
        type: number
      storedBytes:
        type: number
      pivotRows:
        type: number
      pivotColumns:
        type: number
      aggregation:
        type: string
      valueField:
        type: string
      rowFields:
        type: array
        items:
          type: string
      columnFields:
        type: array
        items:
          type: string
      preview:
        type: array
resources:
  cpu: 0.5
  memory: 256
  timeout: 180
  network:
    hosts: []
---

Построение и запись сводной таблицы в .xlsx через VFS.
