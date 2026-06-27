# Approved template: `sql-storage-skill-example`

Шаблон показывает работу с SQL storage через `async function handler(state, params)` и `state.capabilities['sql-storage']` (в коде — alias `sqlStorage`).

Что можно копировать как есть:

- lifecycle `sqlStorage.get()` → `storage_id` → `sqlStorage.runSQL(storageId, sql)`
- PostgreSQL DDL (`SERIAL`, `GENERATED ALWAYS AS IDENTITY`)
- schema и resources skeleton

Что обязательно заменить:

- имя навыка
- имя таблицы и SQL
- prompt и description

Что запрещено менять по форме:

- не использовать `type: sql` с `query/execute/getTables` — это не runtime-контракт Ladcraft
- не обращаться к `state.capabilities.sql`
- не писать SQLite-синтаксис (`AUTOINCREMENT`, `INTEGER PRIMARY KEY AUTOINCREMENT`)
- не путать skill capability `sql-storage` с agent-tool `sqlStorage` в чате агента (разные surface)
- не чинить доступ к `state.capabilities` через TypeScript/JSDoc; используй только runtime guards

Примечание: `runSQL` принимает ровно один PostgreSQL statement за вызов.
