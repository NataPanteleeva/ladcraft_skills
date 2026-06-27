---
name: seedTable
description: Создаёт демо-таблицу и вставляет строку через sql-storage в native handler.
scriptFile: seedTable.js
schemas:
  input:
    type: object
    additionalProperties: false
    properties:
      table_name:
        type: string
        description: Имя таблицы (латиница, цифры, подчёркивание).
  output:
    type: object
    additionalProperties: false
    required:
      - ok
    properties:
      ok:
        type: boolean
      tableName:
        type: string
      storageId:
        type: string
      error:
        type: string
      insertResult:
        type: object
resources:
  cpu: 0.2
  memory: 128
  timeout: 60
  network:
    hosts: []
---

Approved sql-storage example. Используйте `get` и `runSQL` с PostgreSQL dialect.
