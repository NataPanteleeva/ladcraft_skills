# Формат навыка в `cursor_ladcraft`

Этот документ описывает только текущий рабочий формат `cursor_ladcraft`: как устроена папка навыка, какие поля реально читает dev-server и как `scripts/*.js` (native `handler`) попадают в publish payload.

## 1. Источник истины

Для новых навыков источником истины являются:

- `mcp_instructions.md`
- этот документ
- approved templates в `docs/ru/skill_templates/`

Произвольные навыки в `skills/` не считаются каноном.

## 2. Рабочая папка навыка

В `cursor_ladcraft` есть один канонический skill-контракт с двумя допустимыми раскладками рабочей папки.

### 2.1. `instruction-only`

```text
skills/<skill_name>/
└── SKILL.md
```

Используйте этот режим, когда навык состоит только из инструкций и не требует локальных tool-файлов.

### 2.2. `tool-based`

```text
skills/<skill_name>/
├── SKILL.md
├── scripts/
│   ├── <tool_name>.js
│   ├── <tool_name>.meta.md
│   └── <widget_name>.widget.js
└── widgets/
    └── <widget_name>.MD
```

Правила:

- `SKILL.md` обязателен всегда.
- Для `instruction-only` `scripts/` и `widgets/` не требуются.
- Для каждого tool в `tool-based` должна существовать пара: `.js` + `.meta.md`.
- Виджет опционален.
- Файловое имя tool должно совпадать с `name` внутри `*.meta.md`.
- Имя tool в `mcp_spec.tools[].name` должно совпадать с meta/script.

## 3. Что лежит в `SKILL.md`

`SKILL.md` содержит:

1. YAML frontmatter
2. Markdown-тело prompt-а навыка

Минимально обязательны:

```yaml
---
name: my_skill
description: Краткое описание
---
```

После закрывающего `---` идёт текст prompt-а, который попадёт в поле `skill` publish payload.

### 3.1. Где объявлять `environment`

`environment` для tool задаётся только в `SKILL.md -> mcp_spec.tools[]`.

Корректный пример:

```yaml
---
name: greeting_skill
description: Пример навыка с user env
mcp_spec:
  tools:
    - name: getConfiguredGreeting
      environment:
        app:
          BASE_URL: "https://api.example.com"
        user:
          API_TOKEN:
            title: "API token"
            format: "string"
---
```

Нельзя считать `environment` в `*.meta.md` publish-источником истины. `cursor_ladcraft` publish/runtime использует для этого `mcp_spec.tools[]`.

### 3.2. Где объявлять default capabilities

Если нужны явные capabilities поверх автоопределения, задавайте их в:

```yaml
mcp_spec:
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
```

Что значит каждая часть:

- `type` — тип capability. Для новых навыков чаще всего это `key-value-storage` или `vfs`.
- `operations` — список разрешённых операций runtime-адаптера.
- `scope` — область доступа capability. По умолчанию в новых навыках ориентируйтесь на `$USER`, если нет явной причины запрашивать другой scope.

Практические примеры:

```yaml
mcp_spec:
  default_capabilities:
    required:
      - type: key-value-storage
        scope: $USER
        operations:
          - Get
          - Set
      - type: vfs
        scope: $USER
        operations:
          - readFile
          - writeFile
          - listDir
          - mkdir
          - rm
```

Важно:

- `default_capabilities.required` — это декларативный publish-layer контракт для runtime.
- dev-server объединяет автоопределённые capabilities из кода с явно заданными `default_capabilities`.
- внутри `async function handler(state, params)` используйте `state.capabilities` и контракт Ladcraft; не смешивайте целевой handler с устаревшими глобальными обёртками (`input`, `returnResult` как единственный режим файла).

## 4. Что лежит в `scripts/*.meta.md`

В `*.meta.md` dev-server читает только frontmatter. Базовые поля:

| Ключ | Назначение |
|------|------------|
| `name` | Имя tool |
| `description` | Описание tool |
| `scriptFile` | Имя JS-файла, если отличается от basename |
| `schemas` или `inputSchema` / `outputSchema` | JSON Schema входа и выхода |
| `auth` | Служебная auth-информация |
| `order` | Порядок tool |
| `resources` | CPU, memory, timeout, network.hosts |

Рекомендуемый skeleton:

```yaml
---
name: primer
description: Что делает tool
scriptFile: primer.js
schemas:
  input:
    type: object
    properties: {}
    additionalProperties: false
  output:
    type: object
    required: [ok]
    properties:
      ok:
        type: boolean
resources:
  cpu: 0.2
  memory: 128
  timeout: 30
  network:
    hosts: []
---
```

### Не считать источником истины

Для `cursor_ladcraft` не полагайтесь на `*.meta.md` как на главный источник:

- `environment`
- `widget`
- `capabilities`

Они могут встречаться как заметки, но publish-правда берётся не отсюда.

## 5. Что лежит в `scripts/*.js`

Единственный целевой формат — **native Ladcraft handler**:

```javascript
async function handler(state, params) {
  // вход: params; контекст: state.environment, state.capabilities, ...
  return { /* schemas.output */ };
}
```

- Не используйте как целевой формат файла глобали `input`, `returnResult`, `returnResultInWidget`, «голое» тело без `handler` (это устаревший путь; миграция — в `migraciya-navykov-ladcraft.md`).
- VFS/KV — через контракт `state.capabilities` и approved-шаблоны; не опирайтесь на произвольный прямой вызов runtime-методов без согласования с каноном.

## 6. Виджеты

Виджет хранится как:

```text
widgets/<widget_name>.MD
```

Файл состоит из:

1. YAML frontmatter
2. HTML/EJS template

Связка tool → widget задаётся файловым контрактом навыка: handler возвращает объект данных, а publish/preview подхватывает соответствующий `widgets/<name>.MD`.

Практически это означает:

- держите `schemas.output` и `widgets/*.MD` schema согласованными;
- используйте имя widget, которое стабильно разрешается через skill files / metadata;
- не делайте `returnResultInWidget(...)` частью нового целевого authoring-контракта.

### 6.1. Формат виджета

Корректный пример:

```yaml
---
name: statusCard
description: Виджет статуса
schema:
  type: object
  required:
    - title
  properties:
    title:
      type: string
scriptRefs:
  - statusCard.widget.js
---

<div class="rounded-xl border p-4">
  <h2><%= title %></h2>
</div>
```

### 6.2. Что запрещено в виджетах

Запрещено использовать Handlebars block syntax:

- `{{#if ...}}`
- `{{/if}}`
- `{{#each ...}}`

Publish layer ожидает EJS/HTML. Используйте:

```ejs
<% if (items?.length) { %>
  <ul>
    <% items.forEach((item) => { %>
      <li><%= item %></li>
    <% }) %>
  </ul>
<% } %>
```

### 6.3. Сеть для виджетов

Все внешние хосты из template и client-side JS должны попасть в `resources.network.hosts` tool-а. Это относится и к Tailwind CDN.

## 7. Что происходит при publish

Dev-server:

1. Читает `SKILL.md`, а при наличии ещё `scripts/*.meta.md`, `scripts/*.js`, `widgets/*.MD`.
2. Для `tool-based` ожидает в `scripts/*.js` уже **готовый** `async function handler(state, params)` (устаревший вид без `handler` может нормализоваться при миграции/в других инструментах — не целевой формат).
3. Автоопределяет часть capabilities по коду.
4. Берёт `environment` из `mcp_spec.tools[]`.
5. Встраивает widget в `tools[].widget`.

Отсюда следуют правила:

- не оставляйте в одном файле целевой `handler` и непереведённый устаревший стиль без миграции;
- `SKILL.md` и `*.meta.md` должны быть согласованы между собой.

## 8. Согласованность файлов

Перед local run и publish проверьте:

1. Сначала определите режим навыка: `instruction-only` или `tool-based`.
2. Для `tool-based` `SKILL.md -> mcp_spec.tools[].name` совпадает с `scripts/*.meta.md -> name`.
3. Для `tool-based` каждый prompt call в тексте навыка соответствует реальному tool и его schema.
4. `resources.network.hosts` покрывает реальные домены.
5. В `widgets/*.MD` нет Handlebars blocks.
5. В `scripts/*.js` нет `require`, `import`, `module.exports`.

Если есть расхождение между prompt, schema и кодом, правьте навык до запуска: publish wrapper ничего не “додумает” за вас.
