# Anti-pattern: `sql` capability и SQLite DDL вместо `sql-storage`

## Симптомы

- В `mcp_spec.default_capabilities` или `tools[].capabilities.required` указан `type: sql` с операциями `query`, `execute`, `getTables`.
- В handler вызывается `state.capabilities.sql` или `capabilities.sql.execute(...)`.
- DDL использует SQLite (`AUTOINCREMENT`, `INTEGER PRIMARY KEY AUTOINCREMENT`).

## Почему это ошибка

Runtime Ladcraft для skill-скриптов предоставляет capability **`sql-storage`** (PostgreSQL), а не абстрактный `sql`.

Контракт:

- `get()` — получить `storage_id` текущего агента
- `runSQL(storageId, sql)` — один PostgreSQL statement
- при необходимости: `create`, `describe`, `getTableData`, `delete`

## Каноничная замена

```yaml
- type: sql-storage
  scope: $USER
  operations:
    - get
    - runSQL
```

```javascript
const sqlStorage = state.capabilities['sql-storage'];
const existing = await sqlStorage.get();
const storageId = existing.result.storage_id;
await sqlStorage.runSQL(storageId, 'CREATE TABLE IF NOT EXISTS items (id SERIAL PRIMARY KEY, title TEXT)');
```

## Не путать с agent-tool

В чате агента host использует tool **`sqlStorage`** (`action: getByAgent`, `runSQL`, …).

В skill-скрипте — **`state.capabilities['sql-storage']`** (или локальный alias `sqlStorage` после normalize).

Это разные surface одного backend, но разные API entry points.
