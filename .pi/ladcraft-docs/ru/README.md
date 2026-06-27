# Документация навыков Ladcraft (русский), поставка **ladcraft-skills-studio**

Документы описывают **единый канон** формата навыков Ladcraft: структура папки, `SKILL.md`, правила для `scripts/*.js` / `scripts/*.py` и publish. При выборе skills root в приложении копии попадают в `.pi/ladcraft-docs/` вместе с правилами для агента.

## Формат навыка (кратко)

Текущий рабочий формат в отдельной подпапке **непосредственно** внутри выбранного skills root (без лишнего уровня каталога `skills`, если пользователь сам не организовал работу так):

- `SKILL.md` — frontmatter + тело промпта;
- `scripts/<tool_name>.js` — нативный Ladcraft JS handler: `async function handler(state, params) { ... }`;
- `scripts/<tool_name>.py` — нативный Ladcraft Python handler с `runtime: python@3` в meta: `async def handler(state, params):`;
- `scripts/<tool_name>.meta.md` — метаданные инструмента (frontmatter).

Важно для publish/deploy: тело `SKILL.md` после frontmatter должно быть непустым.
Это поле `skill` в payload Ladcraft, и сервер валидирует его как обязательное.

Возможен режим **instruction-only**: только `SKILL.md`, без `scripts/` и `widgets/`. В собранном publish-payload Ladcraft для такого режима допустим пустой массив `tools`. У каждого tool `resources.timeout` задаётся в секундах в диапазоне **1..3600**; массив `resources.network.hosts` указывай только при реальных внешних URL (сам объект `network` в payload обязателен для tool).

**Формат без `handler`** (устаревший стиль с глобалами `input` / `returnResult` / `returnResultInWidget` и т.п., часто называемый «local-style») **не является целевым**. Такой код при миграции **обязательно** переводится в `handler` (см. [Миграция навыка](migraciya-navykov-ladcraft.md)). Не копируй этот стиль в новые навыки.

## Новые фичи Ladcraft (обязательно учитывать)

### 1) Capability `skills`

Новый capability `skills` даёт операции:
- `list(options?)`
- `get(skillId)`
- `update(skillId, skillPatch)`
- `create(skillPayload)`
- `install(skillId, installationForm?)`

Объявление в tool (минимально нужные операции):

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

Использование в `handler`:

```javascript
async function handler(state, params) {
  const skills = state.capabilities.skills;
  const page = await skills.list({ limit: 20, offset: 0, search: params.search });
  const first = page?.applications?.[0];
  if (!first) return { found: 0 };

  const full = await skills.get(first.id);
  await skills.update(first.id, { description: `${full.description || ""}\n\nUpdated by tool` });
  return { updatedSkillId: first.id };
}
```

Запрашивайте только нужные операции. `create` и `install` используйте только при явной задаче на создание/установку skill-приложения; значения `installation_form` агент не выдумывает.

### 1.1) Capability `userInfo`

`userInfo.get()` возвращает email текущего пользователя или пустую строку:

```javascript
async function handler(state) {
  const email = await state.capabilities.userInfo.get();
  return { email };
}
```

### 2) Поле `general` в skill-приложении

`general` — общие настройки на уровне всего навыка (не отдельного инструмента):

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

Merge-правило:
- `general.environment.app` — базовые app-level значения для всех tools;
- `tools[].environment.app` переопределяет совпавшие ключи для конкретного tool.

### 3) Как читать docs без лишних токенов

- Сначала читай `.pi/ladcraft-docs/manifest.json`.
- Затем читай `.pi/ladcraft-docs/ru/topic-index.json` и выбери ветку по типу задачи.
- Потом открывай только файлы, перечисленные в manifest.
- Для больших документов читай по частям: сначала `read(path, offset=1, limit=120)`, затем продолжай точечно через `offset/limit`.
- Если нужен конкретный раздел, ищи якорные слова/заголовок и открывай только окно вокруг нужного места, а не весь файл.
- Не угадывай имена файлов и не делай `read` директорий.
- Не вводи искусственный hard-limit чтения для сложной задачи: приоритет — собрать достаточно контекста, чтобы сделать deploy-ready навык за один проход.

### 4) Эффект задачи должен совпадать с кодом и capabilities

- Если запрос про запись файла в workspace, tool должен реально сделать `state.capabilities.vfs.writeFile(...)`.
- Для такого tool обязательно объяви `vfs` capability с нужными операциями в `mcp_spec.tools[].capabilities.required`.
- Актуальные операции VFS: `readFile`, `writeFile`, `listDir`, `getFileMetadata`, `exists`, `isDir`, `isFile`, `mkdir`, `rm`, `rmdir`, `rmRecursive`, `cp`, `mv`.
- Не заменяй side effect "ответом в чат": если требуется создать файл, он должен быть создан в рабочей области.

### Разрешено агенту

- Писать в `scripts/*.js` только `async function handler(state, params)`, а в `scripts/*.py` только `async def handler(state, params):`.
- Чинить доступ к `state.environment` / `state.capabilities` только runtime guards и plain JavaScript helper-функциями.
- Выносить shared helpers в `SKILL.md -> general.lib[]`: runtime prepends matching lib-код перед handler, поэтому tools вызывают helper-функции напрямую без `require("../lib")`, `module.exports` или `export`.
- При миграции CommonJS helper сначала строить usage map, переносить declarations в `general.lib[]`, переписывать tools на прямой вызов, затем удалять pseudo-tool helper-файл, если это не реальный tool.
- Брать примеры из approved templates и из этого каталога документации.
- Использовать VFS/KV через контракт `state.capabilities` и шаблоны; не опираться на устаревший стиль с глобалами вместо `handler`.

### Запрещено агенту

- Делать новый код в стиле «только `input` / `returnResult` / без `handler`» как целевой формат файла.
- Смешивать в одном `scripts/*.js` / `scripts/*.py` целевой `handler` и устаревший стиль без полной миграции.
- Лечить TS diagnostics в `.js` через `as any`, `: Type`, `interface`, `type`, `enum`, generics, `export`, `module.exports` или JSDoc-типизацию. Imports/require разрешены, если файл остаётся canonical runtime JS tool.
- Копировать паттерны из произвольных соседних папок навыков без сверки с каноном ниже и с [anti-patterns](skill_templates/anti-patterns/).

## Что читать

| Документ | Когда открывать |
|----------|-----------------|
| [Соглашения по формату навыка](rukovodstvo-navyki-ladcraft.md) | Нужен формат папки, `SKILL.md`, `mcp_spec`, `*.meta.md`, `widgets/*.MD` |
| [Руководство по функциям tool](skill-function-tutorial.md) | Нужен native `async function handler(state, params)`, `state`/`params`, VFS/KV через контракт |
| [Миграция навыка в актуальный формат Ladcraft](migraciya-navykov-ladcraft.md) | Переносите старый Ladcraft/runtime skill или сторонний JSON |
| [Pre-publish checklist](kriterii-revyu-navyka.md) | Проверяете готовность навыка перед local run и publish |

## Approved templates

- [minimal-skill/](skill_templates/minimal-skill/) — базовый tool без VFS и widget (native `handler`)
- [instruction-only-example/](skill_templates/instruction-only-example/) — навык только с `SKILL.md`, без локальных tools
- [vfs-skill-example/](skill_templates/vfs-skill-example/) — VFS через контракт handler (см. шаблон)
- [widget-skill-example/](skill_templates/widget-skill-example/) — tool + widget + network hosts
- [environment-user-example/](skill_templates/environment-user-example/) — пример `environment.user` с `SKILL.md -> mcp_spec.tools[]` fallback и пояснением, как это соотносится с `scripts/*.meta.md`
- [general-lib-shared-helper/](skill_templates/general-lib-shared-helper/) — approved shared helper через `SKILL.md -> general.lib[]`, без финальной папки `lib/` и без CommonJS exports
- [runtime-handler-reference/](skill_templates/runtime-handler-reference/) — только publish/runtime reference
- [migrated-skill/](skill_templates/migrated-skill/) — пример собранного payload
- [anti-patterns/](skill_templates/anti-patterns/) — запрещённые паттерны

## Важное правило

Произвольные папки навыков внутри выбранного skills root не являются reference-библиотекой. Они могут содержать смесь рабочих, legacy и конфликтующих навыков. Для новых инструкций и новых навыков ориентируйтесь только на документы из этого каталога и approved templates.
