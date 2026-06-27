# Anti-patterns для навыков Ladcraft (ladcraft-skills-studio)

Этот каталог содержит запрещённые паттерны. Их цель — показать, что не надо копировать в новые навыки.

Список:

- `local-style-not-target.md` — почему нельзя делать новый код без native `handler` (устаревший «local-style»)
- `vfs-runtime-methods.js` — anti-pattern: обход контракта VFS (runtime-методы без канона)
- `widget-handlebars-blocks.MD` — widget с Handlebars blocks
- `environment-in-meta.meta.md` — попытка объявить `environment` в meta
- `ghost-tools-skill.md` — prompt, который ссылается на platform/runtime-tools вне навыка или притворяется `instruction-only` навыком с несуществующими локальными tools
- `sql-vs-sql-storage.md` — устаревший `type: sql`, `capabilities.sql`, SQLite DDL вместо `sql-storage` (PostgreSQL)

Если вы видите похожий паттерн в существующем навыке, считайте это legacy-отклонением, а не примером для копирования.
