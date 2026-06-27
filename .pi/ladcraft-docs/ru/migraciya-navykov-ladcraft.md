# Миграция навыка в актуальный формат Ladcraft (ladcraft-skills-studio)

Этот документ описывает перенос навыка из старого Ladcraft/runtime формата или стороннего JSON в текущий формат, поддерживаемый ladcraft-skills-studio.

Цель миграции: не просто разложить файлы по папкам, а привести каждый tool к **`async function handler(state, params)`** в `scripts/*.js` и согласованным meta — тому контракту, который реально понимают рантайм и publish (устаревший вид без `handler` в целевом виде не оставляем).

## 1. Во что мигрируем

Итоговая структура:

```text
<skills-root>/<skill_name>/
├── SKILL.md
├── scripts/
│   ├── <tool>.js
│   ├── <tool>.meta.md
│   └── <widget>.widget.js
└── widgets/
    └── <widget>.MD
```

## 2. Базовый поток миграции

1. Получить исходный skill: JSON, old Ladcraft payload или произвольный экспорт.
2. Выбрать approved template как стартовую форму.
3. Перенести prompt в тело `SKILL.md`.
4. Для каждого tool создать `scripts/<tool>.js` и `scripts/<tool>.meta.md`.
5. Если есть widget, перенести его в `widgets/<widget>.MD`.
6. Проверить environment, schemas, resources и вызовы tool в prompt.
7. Прогнать local run и deploy diagnostics.

## 3. Маппинг полей

| Старое поле | Куда переносить в актуальном формате |
|-------------|-------------------------------------|
| `body` / `skill` | Markdown-тело `SKILL.md` |
| `scripts[].name` | `scripts/<name>.js` + `scripts/<name>.meta.md` |
| `scripts[].code` / `tools[].function` | `scripts/<name>.js` с **native** `async function handler(state, params)` (legacy-код перевести в handler) |
| `description`, `schemas`, `resources` | frontmatter в `scripts/<name>.meta.md` |
| `environment` | `SKILL.md -> mcp_spec.tools[].environment` |
| `widgets[]` / `tools[].widget` | `widgets/<widget>.MD` |

## 4. Самая частая ошибка при миграции

Самая опасная ошибка — копировать фрагменты старого runtime-кода без приведения к одному каноническому `handler` и согласованному использованию `state.capabilities`.

### Что ломается, если копировать старый код как есть

- Смешение несовместимых слоёв: ожидание alias-глобалов там, где уже нужен явный `state.capabilities` внутри `handler`.
- Prompt навыка требует platform tools (`delegateToAgent`, `runDialog`, `workspace(...)`, `skills activate ...`), которых в пакете навыка нет.
- Widget переносится с Handlebars block syntax, хотя publish-layer ждёт EJS.
- `environment` переносят в `*.meta.md`, но рантайм берёт его из `SKILL.md`.
- В старом коде предполагается широкий KV/VFS API без явного контракта в `handler`.

Если просто перенести код без приведения к **`async function handler(state, params)`**, получится навык, который выглядит знакомо, но расходится с контрактом ladcraft-skills-studio.

## 5. Как правильно переносить код

Целевой вид `scripts/<tool>.js` — **native handler**. Устаревший код с `input`, `returnResult`, телом без `handler` переписывается в handler (см. `skill-function-tutorial.md`).

### 5.1. Если исходник — legacy (глобали `input` / `returnResult` / нет `handler`)

Переведите в один `async function handler(state, params)`:

| Было (legacy) | Стало (канон) |
|---------------|----------------|
| `input` | `params` |
| `returnResult(x)` / `returnResultInWidget(w, x)` | `return x` + согласование widget через meta / `widgets/*.MD` |
| `env` | `state.environment` (`app` / `user`) |
| alias `vfs` / `skillStorage` | `state.capabilities` и контракт Ladcraft (как в approved-шаблонах) |

### 5.2. Если исходник уже `async function handler(state, params)`

Сохраните handler; проверьте `params`, `state.environment`, `state.capabilities`, отсутствие VM-bootstrap-хвостов, согласованность имён и schema.

### 5.3. Справочный каталог

`docs/ru/skill_templates/runtime-handler-reference/` — типы и примеры; не смешивайте со старым слоем без миграции.

## 6. Миграция виджетов

Старый HTML/widget переносите так:

1. Frontmatter: `name`, `description`, `schema`, при необходимости `scriptRefs`.
2. Тело: EJS/HTML.
3. Если есть client-side JS, переносите в `scripts/<widget>.widget.js`.

Запрещено переносить Handlebars blocks без переписывания на EJS.

## 7. Миграция environment

Если старый skill читает:

```javascript
state.environment.user.API_TOKEN
```

в ladcraft-skills-studio это должно быть объявлено так:

```yaml
mcp_spec:
  tools:
    - name: myTool
      environment:
        user:
          API_TOKEN:
            title: "API token"
            format: "string"
```

Если переносите контракт в `*.meta.md`, убедитесь, что итоговый `tools[].environment` publish payload совпадает с ожидаемым. `SKILL.md -> mcp_spec.tools[].environment.*` остаётся допустимым fallback/shared-описанием, но не единственным источником.

## 8. Post-migration gate

Миграция завершена только если:

1. `mcp_spec.tools[].name` совпадает с meta/script.
2. `environment` после миграции предсказуемо собирается в итоговый `tools[].environment` (из meta и/или `SKILL.md -> mcp_spec.tools[]`, без противоречий).
3. Каждый `scripts/*.js` — native `handler`, вызовы VFS/KV через контракт.
4. Widget переписан на EJS.
5. Prompt не требует несуществующих runtime-tools.
6. Local run и deploy diagnostics проходят без ручной подгонки.

Если хотя бы один пункт не выполнен, навык ещё не мигрирован в актуальный формат Ladcraft для ladcraft-skills-studio.
