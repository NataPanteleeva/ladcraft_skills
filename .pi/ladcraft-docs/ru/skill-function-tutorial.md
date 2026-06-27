# Функции-инструменты Ladcraft (ladcraft-skills-studio)

## Единственный формат для `scripts/*.js` / `scripts/*.py`

В каждом `scripts/<tool_name>.js` должен быть **ровно один** публикуемый JS-контракт:

```javascript
async function handler(state, params) {
  // ...
}
```

В каждом `scripts/<tool_name>.py` с `runtime: python@3` в `scripts/<tool_name>.meta.md` должен быть Python-контракт:

```python
async def handler(state, params):
    return {"ok": True}
```

- Вход: `params` (аргументы tool по `schemas.input`).
- Контекст: `state.environment`, `state.capabilities`, при необходимости `state.appHost`, `state.socket` — см. типизацию в `docs/ru/skill_templates/runtime-handler-reference/` и runtime-декларации.
- Выход: `return { ... }` согласно `schemas.output`.
- Виджет: возвращаемые данные + согласование с `tools[].widget` / `widgets/*.MD`; не использовать legacy-хвосты VM-bootstrap после `handler`.

**Не допускается:** скрипты только с глобалами `input`, `returnResult`, `returnResultInWidget`, «голым» телом без `handler` и любой иной «local-style» вид как целевой формат. Старый такой код при миграции переводится в `handler` (см. `migraciya-navykov-ladcraft.md`).

## Минимальный пример

```javascript
async function handler(state, params) {
  const message =
    typeof params?.message === "string" && params.message.trim() ? params.message.trim() : "";

  if (!message) {
    return { ok: false, message: "message обязателен" };
  }

  return { ok: true, message };
}
```

## Канонический helper-pattern для plain JavaScript

TypeScript diagnostics в `.js` **не означают**, что можно писать TypeScript или JSDoc-типы. Если валидатор жалуется на `unknown` или на отсутствие свойства, исправляйте это только runtime guards.

```javascript
function asObject(value) {
  return value && typeof value === 'object' ? value : null;
}

function getObject(source, key) {
  const object = asObject(source);
  if (!object) return null;
  return asObject(object[key]);
}

function getString(source, key) {
  const object = asObject(source);
  if (!object) return '';
  const value = object[key];
  return typeof value === 'string' ? value : '';
}

function getNumber(source, key) {
  const object = asObject(source);
  if (!object) return 0;
  const value = object[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function getBoolean(source, key) {
  const object = asObject(source);
  if (!object) return false;
  const value = object[key];
  return typeof value === 'boolean' ? value : false;
}

function getArray(source, key) {
  const object = asObject(source);
  if (!object) return [];
  const value = object[key];
  return Array.isArray(value) ? value : [];
}

function getFunction(source, key) {
  const object = asObject(source);
  if (!object) return null;
  const value = object[key];
  return typeof value === 'function' ? value : null;
}

async function handler(state, params) {
  const csvPath = getString(params, 'csvPath').trim();
  if (!csvPath) {
    return {
      ok: false,
      error: 'csvPath обязателен'
    };
  }

  const capabilities = getObject(state, 'capabilities');
  const vfs = getObject(capabilities, 'vfs');
  if (!vfs || typeof vfs.readFile !== 'function') {
    return {
      ok: false,
      error: 'VFS readFile недоступен'
    };
  }

  const content = await vfs.readFile(csvPath);
  return {
    ok: true,
    length: content.length
  };
}
```

## VFS и storage внутри handler

Используйте **`state.capabilities`**: адаптеры VFS/KV создаются runtime из `capabilities.required` и meta.
Для VFS в новом коде ориентируйтесь на runtime-контракт `readFile` / `writeFile` / `listDir` / `getFileMetadata` /
`exists` / `isDir` / `isFile` / `mkdir` / `rm` / `rmdir` / `rmRecursive` / `cp` / `mv` и approved-шаблоны
(`vfs-skill-example`, `runtime-handler-reference`).

Для записи файла в workspace вызывайте `await state.capabilities.vfs.writeFile('/workspace/path/file.txt', content)`.
`writeFile` создаёт недостающие родительские директории; отдельный `mkdir('/workspace')` нужен только если задача именно создать пустую директорию.
Не выносите методы VFS в отдельные переменные (`const writeFile = vfs.writeFile; await writeFile(...)`):
каноничный и устойчивый стиль — вызывать метод на объекте capability: `await vfs.writeFile(...)`.

Если в Ladcraft chat export tool упал с `TOOL_TIMEOUT`, не считайте это доказательством ошибки `resources.timeout` или VFS-кода.
Сначала изучите `toolResult`, `rawSseEvents`/timeline и runtime/tool policy: agent tool executor может иметь собственный timeout поверх skill meta.
Сравните `app_id`/`skill_id` упавшего tool из export с `.from-server.json` активного навыка. Если id отличаются, локальная папка, которую вы правите, вероятно, не тот remote-навык, который реально падал.
Не называйте ручной call-binding VFS-метода, `mkdir('/workspace')`, `resources.timeout` или другой warning корневой причиной timeout без прямого подтверждения в raw toolResult/events.

## SQL storage внутри handler

Для таблиц и SQL в skill-скриптах используйте capability **`sql-storage`** в `state.capabilities`, а не устаревший `type: sql`.

Каноничный lifecycle:

1. `const sqlStorage = state.capabilities['sql-storage'];`
2. `const existing = await sqlStorage.get();`
3. `const storageId = existing.result.storage_id;`
4. `await sqlStorage.runSQL(storageId, '<один PostgreSQL statement>');`

Декларация в `mcp_spec` / `tools[].capabilities.required`:

```yaml
- type: sql-storage
  scope: $USER
  operations:
    - get
    - runSQL
```

Важно:

- dialect — **PostgreSQL** (`SERIAL`, `GENERATED ALWAYS AS IDENTITY`); не используйте SQLite `AUTOINCREMENT`;
- `runSQL` принимает ровно один statement за вызов;
- не обращайтесь к `state.capabilities.sql` — такого runtime adapter нет.

Отличие от чата агента: в host workspace агент вызывает tool **`sqlStorage`** (`action: getByAgent`, `runSQL`, …).
В skill-скрипте — только **`state.capabilities['sql-storage']`** (см. `sql-storage-skill-example` и `anti-patterns/sql-vs-sql-storage.md`).

## Запрещено в tool-скриптах

- `export`, `module.exports` и любой иной module export shape
- TypeScript-синтаксис: `as Type`, `as any`, `as unknown`, `: Type`, `<T>`, `interface`, `type`, `enum`, non-null assertion `!`
- JSDoc-типизация: `@type`, `@typedef`, `@param {...}`, `@returns {...}`
- Хвосты после `handler`: `const result = await handler(...); returnResult(result);` и аналоги
- Handlebars block syntax в виджетах (см. отдельно гайды по `widgets/*.MD`)

Shared helper-код для нескольких tools не оформляется как CommonJS helper. Помести declarations в `SKILL.md -> general.lib[]`; runtime prepends matching lib-код перед handler, поэтому в JS вызывай helper-функции напрямую без `require("../lib")`, `module.exports` или `export`, а в Python как обычные top-level функции. При миграции старого `scripts/<helper>.js` сначала составь usage map, затем перенеси declarations в `general.lib[]`, перепиши tools и только потом удаляй pseudo-tool helper-файл/meta.

## Декларативный `state` и TypeScript-форма

Ниже — **только справочная TypeScript-форма контракта**. Она нужна для понимания runtime surface и для валидатора, но её **нельзя копировать** в `scripts/*.js` / `tools/*.js`; для Python используй обычный `.py` без TS/JSDoc.

Ключевая мысль: **`capabilities.required` в meta — декларация для runtime**; внутри handler вы работаете с уже предоставленными адаптерами в `state.capabilities`, а не подменяете декларацию произвольным кодом.

### Практическая форма `state` внутри native handler

```ts
type RuntimeCapabilityMap = {
  vfs?: {
    readFile?(path: string, options?: { source?: "parsed" | "original" }): Promise<string>;
    writeFile?(path: string, content: string): Promise<unknown>;
    listDir?(path: string): Promise<unknown>;
    getFileMetadata?(path: string): Promise<unknown>;
    exists?(path: string): Promise<boolean>;
    isDir?(path: string): Promise<boolean>;
    isFile?(path: string): Promise<boolean>;
    mkdir?(path: string): Promise<unknown>;
    rm?(path: string): Promise<unknown>;
    rmdir?(path: string): Promise<unknown>;
    rmRecursive?(path: string): Promise<unknown>;
    cp?(src: string, dest: string): Promise<unknown>;
    mv?(src: string, dest: string): Promise<unknown>;
  };
  "key-value-storage"?: {
    get?(key: string): Promise<string | null>;
    set?(key: string, value: string): Promise<unknown>;
  };
  "sql-storage"?: {
    get?(): Promise<unknown>;
    create?(): Promise<unknown>;
    describe?(storageId: string): Promise<unknown>;
    getTableData?(storageId: string, table: string, limit?: number, offset?: number): Promise<unknown>;
    runSQL?(storageId: string, sql: string): Promise<unknown>;
    delete?(storageId: string): Promise<unknown>;
  };
  skills?: {
    list?(options?: { limit?: number; offset?: number; status?: string; search?: string }): Promise<unknown>;
    get?(skillId: string): Promise<unknown>;
    create?(skill: unknown): Promise<unknown>;
    update?(skillId: string, skillPatch: unknown): Promise<unknown>;
    install?(skillId: string, installationForm?: Record<string, unknown>): Promise<unknown>;
  };
  userInfo?: {
    get?(): Promise<string>;
  };
  [capabilityType: string]: unknown;
};

type HandlerState = {
  runtime?: "nodejs@24" | "python@3";
  environment: {
    app: Record<string, unknown>;
    user: Record<string, unknown>;
  };
  capabilities: RuntimeCapabilityMap;
  resources?: {
    cpu: number;
    memory: number;
    timeout: number;
    network: {
      hosts: string[];
    };
  };
  schemas?: {
    input: Record<string, unknown>;
    output: Record<string, unknown>;
  };
  appHost?: string;
  socket?: {
    redirect?(payload: { url: string }): void;
    removeAllListeners?(event: string): void;
    destroy?(): void;
  };
};
```

## `environment`

В итоговом payload environment должен попасть в `tools[].environment`.
В авторинге разрешены оба источника:
- `scripts/*.meta.md` → `environment.*` для конкретного tool;
- `SKILL.md` → `mcp_spec.tools[].environment.*` как fallback/shared-описание.

`environment.user.<KEY>` описывается объектом `{ title, format }`; для install-time массивов добавляйте `isArray: true`.

Чтение в handler:

```javascript
const apiToken = state.environment.user.API_TOKEN;
```

## Capability `skills` в handler

Если tool должен читать/обновлять/создавать/устанавливать навыки, объявите capability `skills` в `tools[].capabilities.required`,
а в коде используйте только `state.capabilities.skills`.

```javascript
async function handler(state, params) {
  const skills = state.capabilities.skills;
  if (!skills) {
    return { ok: false, error: "capability skills недоступен" };
  }

  const page = await skills.list({
    limit: 20,
    offset: 0,
    search: typeof params?.search === "string" ? params.search : ""
  });

  const target = page?.applications?.[0];
  if (!target) {
    return { ok: true, changed: false, reason: "not-found" };
  }

  const full = await skills.get(target.id);
  await skills.update(target.id, {
    description: `${full.description || ""}\n\nUpdated by tool`
  });

  return { ok: true, changed: true, skillId: target.id };
}
```

Guardrails:
- least privilege: не запрашивай лишние операции;
- всегда `get` перед `update`;
- `create` и `install` используй только при явной задаче; installation values не выдумывай;
- явно задавай `limit/offset` и статус-фильтры, если они есть в задаче.

## Capability `userInfo` в handler

Если tool нужен email текущего пользователя, объявите capability `userInfo` с операцией `get` и вызывайте
`await state.capabilities.userInfo.get()`. Runtime возвращает email или пустую строку.

## Поле `general` для общих app-level данных

На уровне skill-приложения можно задать общий блок:

```json
{
  "general": {
    "environment": {
      "app": {
        "API_BASE_URL": "https://api.example.com",
        "DEFAULT_REGION": "eu"
      }
    },
    "lib": [
      {
        "runtime": "nodejs@24",
        "code": "function normalizeEmail(v){ return String(v || '').trim().toLowerCase(); }"
      }
    ]
  }
}
```

Правило merge:
- база: `general.environment.app`;
- переопределение: `tools[].environment.app` для конкретного инструмента.

Критерий:
- если значение нужно нескольким tools, клади в `general`;
- если только одному tool, оставляй на уровне `tools[]`.

## `skillStorage` / KV

Для runtime-state и кэша используйте адаптер key-value-storage через `state.capabilities`, в духе контракта навыка. Не закладывайтесь на расширенный API как на обязательный минимум без проверки в шаблонах.

## Виджеты

Связка tool → шаблон `widgets/*.MD` при publish/preview в ladcraft-skills-studio разрешается так (в указанном порядке):

1. Имя из маркера в коде `handler` (`/*__CURSOR_LADCRAFT_WIDGET_NAME__=<slug>*/`) или из устаревшего вызова `returnResultInWidget('…')` при миграции.
2. Иначе — совпадение с именем инструмента (`name` в `*.meta.md` / basename `scripts/<tool>.js` или `scripts/<tool>.py`) и **basename файла** `widgets/<slug>.md` или полем `name` в YAML frontmatter этого файла.
3. Если в папке `widgets/` ровно один `.md`, студия может подставить его как запасной вариант, но **не полагайтесь на это**: при нескольких виджетах без совпадения имён шаблон не попадёт в publish.

Данные для EJS: **`handler` возвращает плоский объект** — поля должны совпадать с `schemas.output` и с переменными в шаблоне (`<%= field %>`). Не возвращайте вложенный объект `widget: { type, name, data }` вместо полей шаблона — Ladcraft и ladcraft-skills-studio ожидают плоский результат tool для рендера виджета.

Ориентир по структуре файлов: `skill_templates/widget-skill-example/` (в каталоге `resources/skills-docs/ru/`). Без legacy `returnResultInWidget` в новом каноне, если не нужен явный маркер — совпадайте именами файла виджета и tool.

## Сеть

Каждый внешний хост — в `resources.network.hosts`. Запросы через `fetch` (или HTTP-клиент, разрешённый контрактом).

```javascript
const response = await fetch("https://api.example.com/ping");
if (!response.ok) {
  return { ok: false, error: `HTTP ${response.status}` };
}
return { ok: true, data: await response.json() };
```

## Справка по миграции со старого формата

Устаревшие глобали (`input`, `returnResult`, local-style обёртки) при переносе навыка **заменяются** на `async function handler(state, params)` и явный `return`. Таблица соответствий для миграции — в `migraciya-navykov-ladcraft.md`.

## Дополнительно

Подробные типы и примеры: `docs/ru/skill_templates/runtime-handler-reference/`.
