# Approved template: `vfs-skill-example`

Шаблон показывает работу с VFS через `async function handler(state, params)` и `state.capabilities`.

Что можно копировать как есть:

- использование только `vfs.read`, `vfs.write`, `vfs.list`, `vfs.delete`
- schema и resources skeleton

Что обязательно заменить:

- имя навыка
- путь и содержимое файла
- prompt и description

Что запрещено менять по форме:

- не заменять alias-методы на `readFile/writeFile/exists/mv/rm`
- не выносить `environment` в meta
