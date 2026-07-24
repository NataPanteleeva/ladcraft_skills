---
name: vfs-skill-example
description: Approved template для работы с VFS через native handler и state.capabilities.
mcp_spec:
  tools:
    - name: saveWorkspaceNote
  default_capabilities:
    required:
      - type: vfs
        scope: $USER
        operations:
          - readFile
          - writeFile
          - listDir
          - mkdir
          - rm
---

# VFS skill example

Навык показывает корректный вызов tool с `handler`, который пишет заметку в workspace через контракт VFS.

## Что делать агенту

1. Проверить вход `saveWorkspaceNote`.
2. Вызвать `saveWorkspaceNote`.
3. Использовать только результат этого tool без дополнительных runtime-конструкций.

## Ограничения

- Не использовать runtime-методы VFS напрямую.
- Не подменять VFS shell-командами и ghost tools.
