---
name: sql-storage-skill-example
description: Approved template для работы с sql-storage через native handler и state.capabilities.
mcp_spec:
  tools:
    - name: seedTable
  default_capabilities:
    required:
      - type: sql-storage
        scope: $USER
        operations:
          - get
          - runSQL
---

# SQL storage skill example

Навык показывает корректный вызов tool с `handler`, который создаёт таблицу и вставляет строку через capability `sql-storage` (PostgreSQL).

## Что делать агенту

1. Проверить вход `seedTable`.
2. Вызвать `seedTable`.
3. Использовать только результат этого tool без дополнительных runtime-конструкций.

## Ограничения

- Не использовать устаревший `type: sql` или `state.capabilities.sql`.
- Не писать SQLite DDL (`AUTOINCREMENT`); dialect — PostgreSQL.
- Не подменять sql-storage shell-командами и ghost tools.
