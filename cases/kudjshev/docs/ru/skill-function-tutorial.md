# Функции-инструменты в `cursor_ladcraft`

## Единственный формат для `scripts/*.js`

В каждом `scripts/<tool_name>.js` должен быть **ровно один** публикуемый контракт:

```javascript
async function handler(state, params) {
  // ...
}
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

## VFS и storage внутри handler

Используйте **`state.capabilities`**: адаптеры VFS/KV создаются runtime из `capabilities.required` и meta. Не вызывайте «сырой» runtime-shape `vfs.readFile`/`writeFile` как основной контракт в новом коде — ориентируйтесь на контракт Ladcraft и approved-шаблоны (`vfs-skill-example`, `runtime-handler-reference`).

Safe alias-методы уровня `read` / `write` / `list` / `delete` применимы там, где это отражено в типах и шаблонах проекта; не смешивайте с устаревшими глобальными обёртками.

## Запрещено в tool-скриптах

- `require(...)`, `import ...`, `module.exports`
- Хвосты после `handler`: `const result = await handler(...); returnResult(result);` и аналоги
- Handlebars block syntax в виджетах (см. отдельно гайды по `widgets/*.MD`)

## Декларативный `state` и TypeScript-форма

Ниже — справочная форма контракта (см. также раздел 3 в прежних версиях документа и `runtime-handler-reference`).

Ключевая мысль: **`capabilities.required` в meta — декларация для runtime**; внутри handler вы работаете с уже предоставленными адаптерами в `state.capabilities`, а не подменяете декларацию произвольным кодом.

### Практическая форма `state` внутри native handler

```ts
type RuntimeCapabilityMap = {
  vfs?: {
    readFile?(path: string): Promise<string>;
    writeFile?(path: string, content: string): Promise<unknown>;
    listDir?(path: string): Promise<unknown>;
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

Задаётся только в `SKILL.md` → `mcp_spec.tools[].environment`.

Чтение в handler:

```javascript
const apiToken = state.environment.user.API_TOKEN;
```

## `skillStorage` / KV

Для runtime-state и кэша используйте адаптер key-value-storage через `state.capabilities`, в духе контракта навыка. Не закладывайтесь на расширенный API как на обязательный минимум без проверки в шаблонах.

## Виджеты

Связка tool → widget задаётся метаданными и шаблонами `widgets/*.MD`; данные возвращайте из `handler` в соответствии со схемой и виджетом (без legacy `returnResultInWidget` в новом каноне).

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
