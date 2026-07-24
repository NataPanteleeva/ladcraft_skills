# Anti-patterns для `cursor_ladcraft`

Этот каталог содержит запрещённые паттерны. Их цель — показать, что не надо копировать в новые навыки.

Список:

- `vfs-runtime-methods.js` — anti-pattern: обход контракта VFS (runtime-методы без канона)
- `widget-handlebars-blocks.MD` — widget с Handlebars blocks
- `environment-in-meta.meta.md` — попытка объявить `environment` в meta
- `ghost-tools-skill.md` — prompt, который ссылается на platform/runtime-tools вне навыка или притворяется `instruction-only` навыком с несуществующими локальными tools

Если вы видите похожий паттерн в существующем навыке, считайте это legacy-отклонением, а не примером для копирования.
