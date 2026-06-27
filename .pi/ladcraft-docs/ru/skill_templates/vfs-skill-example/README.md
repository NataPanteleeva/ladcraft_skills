# Approved template: `vfs-skill-example`

Шаблон показывает JS-вариант работы с VFS через `async function handler(state, params)` и `state.capabilities`.
Если контекст/настройки агента требуют Python, сохраняйте те же schemas/resources/capabilities и VFS-методы, но используйте `scripts/<tool>.py`, `runtime: python@3` и `async def handler(state, params):`.

Что можно копировать как есть:

- использование runtime-методов из текущего VFS surface: `readFile`, `writeFile`, `listDir`, `getFileMetadata`, `exists`, `isDir`, `isFile`, `mkdir`, `rm`, `rmdir`, `rmRecursive`, `cp`, `mv`
- schema и resources skeleton

Что обязательно заменить:

- имя навыка
- путь и содержимое файла
- prompt и description

Что запрещено менять по форме:

- не заменять runtime-контракт VFS на alias-вызовы `vfs.read/vfs.write/vfs.list/vfs.delete`
- не выносить `environment` в meta
- не чинить доступ к `state.capabilities` через TypeScript/JSDoc; используй только runtime guards
- не лечить `TOOL_TIMEOUT` механическим увеличением `resources.timeout` или добавлением `mkdir('/workspace')`: сначала проверь export/toolResult и runtime policy
- при разборе export сравнить `app_id`/`skill_id` упавшего tool с `.from-server.json` активного навыка; если id отличаются, сначала сообщить, что чинится не тот remote-навык
- не объявлять ручной call-binding VFS-метода, `mkdir('/workspace')` или timeout-настройку корневой причиной без прямого подтверждения в raw toolResult/events

Примечание: `vfs.writeFile('/workspace/path/file.txt', content)` сам создаёт недостающие родительские директории.
`vfs.mkdir(...)` нужен для явного создания пустой директории, а не как обязательный шаг перед каждой записью файла.
Не выносите capability-методы в отдельные переменные: вместо `const writeFile = vfs.writeFile; await writeFile(...)`
пишите `await vfs.writeFile(...)`.
