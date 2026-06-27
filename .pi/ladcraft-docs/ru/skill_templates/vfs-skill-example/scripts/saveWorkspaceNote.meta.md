---
name: saveWorkspaceNote
description: Сохраняет заметку в workspace через VFS в native handler.
scriptFile: saveWorkspaceNote.js
schemas:
  input:
    type: object
    additionalProperties: false
    required:
      - path
      - content
    properties:
      path:
        type: string
        description: Абсолютный путь внутри VFS, например /workspace/notes/hello.md
      content:
        type: string
        description: Содержимое файла.
  output:
    type: object
    additionalProperties: false
    required:
      - ok
      - savedPath
    properties:
      ok:
        type: boolean
      savedPath:
        type: string
resources:
  cpu: 0.2
  memory: 128
  timeout: 30
  network:
    hosts: []
---

Approved VFS example. Используйте runtime-контракт `vfs.writeFile` для записи в workspace.
Если создаёте Python tool по default runtime, замените `scriptFile` на `.py`, добавьте `runtime: python@3` и реализуйте top-level `async def handler(state, params):`.
