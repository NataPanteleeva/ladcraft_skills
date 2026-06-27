# Формат навыка Ladcraft (ladcraft-skills-studio)

Этот документ описывает текущий рабочий формат Ladcraft в ladcraft-skills-studio: как устроена папка навыка, какие поля читает рантайм при сборке и как `scripts/*.js` / `scripts/*.py` (native `handler`) попадают в publish payload.

## 1. Источник истины

Для новых навыков источником истины являются:

- этот каталог документации (`README.md` и файлы ниже)
- этот документ
- approved templates в `docs/ru/skill_templates/`

Произвольные соседние папки навыков внутри выбранного skills root не считаются каноном.

## 2. Рабочая папка навыка

В ladcraft-skills-studio есть один канонический skill-контракт с двумя допустимыми раскладками рабочей папки.

### 2.1. `instruction-only`

```text
<skills-root>/<skill_name>/
└── SKILL.md
```

Используйте этот режим, когда навык состоит только из инструкций и не требует локальных tool-файлов.

### 2.2. `tool-based`

```text
<skills-root>/<skill_name>/
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

`environment` для tool задаётся в итоговом publish payload `tools[].environment`. В авторинге допустимы оба источника: `scripts/*.meta.md -> environment.*` и `SKILL.md -> mcp_spec.tools[].environment.*` как fallback/shared-config; если заданы оба, `*.meta.md` имеет приоритет.

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

Нельзя считать `environment` в `*.meta.md` publish-источником истины. ladcraft-skills-studio publish/runtime использует для этого `mcp_spec.tools[]`.

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
- рантайм объединяет автоопределённые capabilities из кода с явно заданными `default_capabilities`.
- внутри `async function handler(state, params)` используйте `state.capabilities` и контракт Ladcraft; не смешивайте целевой handler с устаревшими глобальными обёртками (`input`, `returnResult` как единственный режим файла).

### 3.3. Новый capability `skills` в инструментах

Capability `skills` позволяет из tool-кода работать со skill-приложениями автора:
- `list(options?)`
- `get(skillId)`
- `update(skillId, skillPatch)`
- `create(skillPayload)`
- `install(skillId, installationForm?)`

Объявляйте capability явно на уровне инструмента:

```json
{
  "capabilities": {
    "required": [
      {
        "type": "skills",
        "operations": ["list", "get", "update"]
      }
    ]
  }
}
```

Важно:
- выдавайте минимально нужные операции (least privilege);
- перед `update` сначала делайте `get`, чтобы не потерять поля при частичном патче;
- `create` и `install` используйте только при явной задаче на создание/установку навыка; значения installation form не выдумывайте;
- для массовых сценариев используйте пагинацию `limit/offset`.

Capability `userInfo` даёт `get()` и возвращает email текущего пользователя или пустую строку.

### 3.4. Новый блок `general` на уровне skill-приложения

`general` хранит общие настройки, которые применяются ко всем tools:

```json
{
  "general": {
    "environment": {
      "app": {
        "API_BASE_URL": "https://api.example.com"
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

Merge-поведение:
- `general.environment.app` задаёт базовые app-level ключи;
- `tools[].environment.app` переопределяет совпавшие ключи для конкретного инструмента.

`environment.user` описывает поля, которые пользователь заполнит при установке навыка. Каждый ключ должен быть объектом:

```yaml
environment:
  user:
    IMAP_HOST:
      title: IMAP host
      format: string
    IMAP_PORT:
      title: IMAP port
      format: number
    IMAP_SECURE:
      title: Use secure IMAP connection
      format: boolean
```

Допустимые `format`: `string`, `number`, `boolean`, `email`, `uri`. В tool значения читаются через `state.environment.user`.

Когда использовать:
- общий конфиг/хелперы для нескольких tools -> `general`;
- настройки только одного инструмента -> `tools[].environment`.

## 4. Что лежит в `scripts/*.meta.md`

В `*.meta.md` при сборке читается только frontmatter. Базовые поля:

| Ключ | Назначение |
|------|------------|
| `name` | Имя tool |
| `description` | Описание tool |
| `scriptFile` | Имя JS/Python-файла, если отличается от basename |
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

Для ladcraft-skills-studio не полагайтесь на `*.meta.md` как на главный источник:

- `environment`
- `widget`
- `capabilities`

Они могут встречаться как заметки, но publish-правда берётся не отсюда.

## 5. Что лежит в `scripts/*.js` / `scripts/*.py`

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

Дополнительно для ladcraft-skills-studio и Ladcraft:

- **Имена:** файл `widgets/<slug>.md` (и `name` в его frontmatter) должны согласовываться с именем tool **или** в `handler` должен быть маркер `/*__CURSOR_LADCRAFT_WIDGET_NAME__=<slug>*/`, иначе при publish HTML виджета может не попасть в payload.
- **Ответ handler:** только плоский JSON-объект полей для EJS; не подменяйте его вложенным объектом `widget: { type, name, data }` — рендер на платформе строится от плоского результата tool.
- В `scripts/*.meta.md` для инструментов с виджетом задавайте **`schemas`** (как в approved-шаблонах), а не только `parameters`/`outputs`.

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

Пайплайн publish в ladcraft-skills-studio:

1. Читает `SKILL.md`, а при наличии ещё `scripts/*.meta.md`, `scripts/*.js`, `scripts/*.py`, `widgets/*.MD`.
2. Для `tool-based` ожидает в `scripts/*.js` готовый `async function handler(state, params)`, а в `scripts/*.py` при `runtime: python@3` готовый `async def handler(state, params):`.
3. Автоопределяет часть capabilities по коду.
4. Берёт `environment` из `mcp_spec.tools[]`.
5. Берёт `general.lib[]` из frontmatter `SKILL.md` и передаёт его в payload без локальной папки `lib/`.
6. Встраивает widget в `tools[].widget`.

Отсюда следуют правила:

- не оставляйте в одном файле целевой `handler` и непереведённый устаревший стиль без миграции;
- shared helpers для нескольких tools держите в `SKILL.md -> general.lib[]`; runtime добавляет первый непустой lib-блок совпадающего runtime перед handler, поэтому в JS helper-функции вызываются напрямую без `require`, `import`, `module.exports` и `export`, а в Python как top-level функции;
- если старый `scripts/<helper>.js` экспортируется через `module.exports` и импортируется несколькими tools, сначала составьте usage map, затем перенесите declarations в `general.lib[]`, перепишите tools на прямые вызовы и удалите pseudo-tool helper-файл/meta, если это не реальный tool;
- финальная локальная папка `lib/` не является deploy-ready способом зависимости навыка; её можно использовать только как временный staging во время миграции;
- `SKILL.md` и `*.meta.md` должны быть согласованы между собой.

## 8. Согласованность файлов

Перед local run и publish проверьте:

1. Сначала определите режим навыка: `instruction-only` или `tool-based`.
2. Для `tool-based` `SKILL.md -> mcp_spec.tools[].name` совпадает с `scripts/*.meta.md -> name`.
3. Для `tool-based` каждый prompt call в тексте навыка соответствует реальному tool и его schema.
4. `resources.network.hosts` покрывает реальные домены.
5. В `widgets/*.MD` нет Handlebars blocks.
6. В `scripts/*.js` разрешены `import`, `require` и dynamic `import(...)`, но не должно быть `export`/`module.exports`, TypeScript-синтаксиса, typed JSDoc и legacy-хвостов после `handler`; в `scripts/*.py` используй `async def handler(state, params):` и `runtime: python@3`.
7. Если несколько tools используют один helper, он находится в одном объединённом `SKILL.md -> general.lib[]` block для runtime, а tool-код вызывает helper напрямую без `require("../lib")`.

Если есть расхождение между prompt, schema и кодом, правьте навык до запуска: publish wrapper ничего не “додумает” за вас.
