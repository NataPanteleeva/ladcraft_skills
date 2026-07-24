# `cursor_ladcraft`: рабочая инструкция для агента

Этот файл — главный operational router для работы в `cursor_ladcraft`.

Используй его как router: сначала прочитай этот документ целиком, затем открывай только нужные reference-файлы из `docs/ru/`. Не подменяй его generic builder-инструкциями, legacy заметками или случайными навыками из `skills/`.

## Что считать каноном

Канон внутри `cursor_ladcraft` состоит из трёх слоёв:

1. Этот файл `mcp_instructions.md` — жёсткие правила и маршрут действий.
2. `docs/ru/*.md` — подтверждающие reference-доки по формату, миграции, функциям и pre-publish review.
3. `docs/ru/skill_templates/*` — approved few-shot примеры и anti-patterns.

Каталог `skills/` не является источником истины. Он содержит рабочие навыки, legacy решения и конфликтующие паттерны. Используй его только как материал для аудита и точечных исправлений.

## Что открыть в первую очередь

Всегда соблюдай порядок:

1. `README.md`
2. `mcp_instructions.md`
3. `docs/ru/README.md`
4. Нужный reference:
   - формат папки и `mcp_spec`: `docs/ru/rukovodstvo-navyki-ladcraft.md`
   - native `handler(state, params)`, TypeScript-форма `state` и `capabilities`: `docs/ru/skill-function-tutorial.md`
   - перенос старого навыка: `docs/ru/migraciya-navykov-ladcraft.md`
   - финальная проверка: `docs/ru/kriterii-revyu-navyka.md`
5. Ближайший approved template из `docs/ru/skill_templates/`

Только после этого создавай или правь навык.

## Рабочие форматы навыка

В `cursor_ladcraft` есть два валидных формата:

### 1. `instruction-only`

```text
skills/<skill_name>/
└── SKILL.md
```

Используйте этот формат, когда навык должен содержать только инструкции и оркестрацию без локальных tool-файлов.

### 2. `tool-based`

```text
skills/<skill_name>/
├── SKILL.md
├── scripts/
│   ├── <tool_name>.js
│   ├── <tool_name>.meta.md
│   └── <widget_name>.widget.js        # опционально
└── widgets/
    └── <widget_name>.MD               # опционально
```

Жёсткие инварианты:

- `SKILL.md` обязателен всегда.
- Для `instruction-only` навыка `scripts/` и `widgets/` не требуются.
- Для `tool-based` каждый tool описывается парой `scripts/<tool>.js` + `scripts/<tool>.meta.md`.
- Native `async function handler(state, params)` — **единственный** authoring-формат для `scripts/*.js` в `tool-based` навыках.
- Legacy-код с глобалами `input` / `returnResult` / без `handler` не считается целевым; при переносе навыка переводится в `handler` (см. `docs/ru/migraciya-navykov-ladcraft.md`).
- `environment` задаётся только через `SKILL.md -> mcp_spec.tools[]`.
- `capabilities.required` — декларативный runtime-контракт; прямой доступ к capability adapters нужен только в native handler reference.
- Виджеты публикуются как EJS/HTML, а не Handlebars block templates.

## Canonical handler runtime

По умолчанию пиши native handler:

- вход: `params`
- выход: `return {...}`
- widget: `return data` + widget в metadata/payload
- environment: `state.environment.app` / `state.environment.user`
- capabilities: `state.capabilities.*`

Старые навыки с устаревшим видом скрипта нужно **привести к `handler`** перед publish; инструменты вроде pi-sys могут нормализовать код при сохранении (см. миграцию и backup в документации).

## Минимальный алгоритм создания навыка

1. Определи режим навыка: `instruction-only` или `tool-based`.
2. Выбери approved template из `docs/ru/skill_templates/`.
3. Создай `SKILL.md` с корректным `name`, `description` и при необходимости `mcp_spec.tools[]`.
4. Если это `tool-based`, создай для каждого tool `scripts/<tool>.meta.md` и `scripts/<tool>.js`.
5. Если нужен widget, создай `widgets/<widget>.MD` и при необходимости `scripts/<widget>.widget.js`.
6. Если это `tool-based`, сверь примерные вызовы tool в prompt с `schemas.input`.
7. Прогони локальный запуск в dev-server.
8. Прогони deploy diagnostics перед publish.

## Разрешено

- Использовать approved examples из `docs/ru/skill_templates/`.
- Делать `instruction-only` навык только с `SKILL.md`, если локальные tools не нужны.
- Писать только `async function handler(state, params)` в `scripts/*.js`.
- Использовать VFS/KV через контракт `state.capabilities` и approved-шаблоны; не опираться на устаревший local-style с глобалами.
- Объявлять `environment.user` и `environment.app` в `SKILL.md -> mcp_spec.tools[]`.
- Использовать EJS в `widgets/*.MD`: `<%= %>`, `<%- %>`, `<% if (...) { %>`.
- Задавать `resources.network.hosts` по реально используемым хостам.
- Оставлять в meta-файлах поясняющий Markdown после frontmatter.

## Запрещено

- Копировать паттерны из случайных навыков в `skills/` без сверки с каноном.
- Использовать как базовый паттерн в новом коде прямые runtime-имена `vfs.readFile`, `vfs.writeFile`, `vfs.exists`, `vfs.mv`, `vfs.rm` без согласования с контрактом handler (см. шаблоны и `skill-function-tutorial.md`).
- Опираться на `skillStorage.delete` и `skillStorage.clear` как на базовый гарантированный контракт.
- Класть `environment.user/app` в `*.meta.md` как источник publish-правды.
- Писать `{{#if}}`, `{{/if}}`, `{{#each}}` и другие Handlebars block-выражения в `widgets/*.MD`.
- Для `tool-based` навыка ссылаться в `SKILL.md` на recovery-tools, runtime-tools или platform-tools, которых нет в самом навыке.
- Для `instruction-only` навыка делать вид, что внутри пакета есть локальные tools, которых на самом деле нет.
- Смешивать в одном файле целевой `handler` и устаревший local-style без миграции.
- Использовать `require`, `import`, `module.exports` в `scripts/*.js`.

## Known bad patterns из аудита

Ниже перечислены типовые дефекты, уже найденные в существующих навыках. Не копируй их.

- В tool-скрипте обходят контракт и вызывают runtime VFS напрямую там, где для канона нужны адаптеры через `state.capabilities` (см. anti-patterns).
- Widget использует Handlebars blocks, хотя publish ожидает EJS.
- Prompt навыка требует `delegateToAgent`, `runDialog`, `workspace(...)`, `skills activate ...` и другие runtime-конструкции, которых нет в пакете навыка.
- `*.meta.md` не содержит `resources`, из-за чего tool теряет явный runtime-контракт.
- Prompt или примеры вызовов расходятся со schema инструмента.

Для антипримеров см. `docs/ru/skill_templates/anti-patterns/`.

## Как выбирать template

Используй только approved templates:

- `minimal-skill/` — старт для обычного tool без VFS и widget (native `handler`).
- `instruction-only-example/` — старт для навыка только с `SKILL.md`, без локальных tools и widgets.
- `vfs-skill-example/` — работа с VFS через контракт handler (см. шаблон).
- `widget-skill-example/` — корректная связка tool + widget + `resources.network.hosts`.
- `environment-user-example/` — корректное объявление `mcp_spec.tools[].environment.user`.
- `runtime-handler-reference/` — reference только для publish-layer.
- `migrated-skill/` — пример собранного payload для сверки.

## Что делать перед локальным запуском

Проверь:

1. Ты явно выбрал режим: `instruction-only` или `tool-based`.
2. Для `tool-based` `mcp_spec.tools[].name` совпадает с именем meta/script.
3. Для `tool-based` у каждого tool есть `description`, `schemas`, `resources`.
4. `environment` объявлен только в `SKILL.md`.
5. В handler script нет `require/import/module.exports`.
6. Если используется widget, tool возвращает данные напрямую, а widget задаётся метаданными.
7. В widget нет Handlebars blocks.
8. Все внешние хосты включены в `resources.network.hosts`.

## Финальный self-check перед publish

Не считай навык готовым, пока не ответишь `да` на все пункты:

1. Это `instruction-only` или `tool-based` навык?
2. Если это `tool-based`, `mcp_spec.tools[].name` совпадает с meta/script?
3. `environment` задан только в `SKILL.md`?
4. Если это `tool-based`, в каждом `scripts/*.js` только `async function handler(state, params)` и допустимые вызовы по контракту?
5. Если есть widget, он не использует Handlebars block syntax?
6. Если есть внешние хосты, `resources.network.hosts` покрывает их все?
7. Если это `tool-based`, prompt не требует tool-ов, которых нет в папке навыка?
8. Если это `instruction-only`, prompt не делает вид, что внутри пакета есть локальные tools?
9. Если это `tool-based`, примерные вызовы в тексте совпадают со schema инструмента?

Если хотя бы один ответ `нет`, вернись к reference-докам и исправь навык до локального запуска или publish.

## Куда смотреть дальше

- Формат папки и `mcp_spec`: `docs/ru/rukovodstvo-navyki-ladcraft.md`
- Функции и runtime-wrapper: `docs/ru/skill-function-tutorial.md`
- Миграция старых навыков: `docs/ru/migraciya-navykov-ladcraft.md`
- Финальный чек: `docs/ru/kriterii-revyu-navyka.md`
- Approved templates и anti-patterns: `docs/ru/skill_templates/`

Legacy-паттерны учитывайте только через migration docs в `docs/ru/`; они не являются частью текущего bundle-контракта `cursor_ladcraft`.
