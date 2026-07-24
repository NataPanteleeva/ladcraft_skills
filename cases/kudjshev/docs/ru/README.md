# Документация `cursor_ladcraft` (русский)

Этот каталог — подтверждающий reference-контур для `cursor_ladcraft`. Главный operational router находится в корне проекта: [`mcp_instructions.md`](../../mcp_instructions.md).

## Что читать

| Документ | Когда открывать |
|----------|-----------------|
| [Соглашения по формату навыка](rukovodstvo-navyki-ladcraft.md) | Нужен формат папки, `SKILL.md`, `mcp_spec`, `*.meta.md`, `widgets/*.MD` |
| [Руководство по функциям tool](skill-function-tutorial.md) | Нужен native `async function handler(state, params)`, `state`/`params`, VFS/KV через контракт |
| [Миграция навыка в формат `cursor_ladcraft`](migraciya-navykov-ladcraft.md) | Переносите старый Ladcraft/runtime skill или сторонний JSON |
| [Pre-publish checklist](kriterii-revyu-navyka.md) | Проверяете готовность навыка перед local run и publish |

## Approved templates

- [minimal-skill/](skill_templates/minimal-skill/) — базовый tool без VFS и widget (native `handler`)
- [instruction-only-example/](skill_templates/instruction-only-example/) — навык только с `SKILL.md`, без локальных tools
- [vfs-skill-example/](skill_templates/vfs-skill-example/) — VFS через контракт handler (см. шаблон)
- [widget-skill-example/](skill_templates/widget-skill-example/) — tool + widget + network hosts
- [environment-user-example/](skill_templates/environment-user-example/) — `mcp_spec.tools[].environment.user`
- [runtime-handler-reference/](skill_templates/runtime-handler-reference/) — только publish/runtime reference
- [migrated-skill/](skill_templates/migrated-skill/) — пример собранного payload
- [anti-patterns/](skill_templates/anti-patterns/) — запрещённые паттерны

## Важное правило

Каталог `skills/` не является reference-библиотекой. Он содержит смесь рабочих, legacy и конфликтующих навыков. Для новых инструкций и новых навыков ориентируйтесь только на `mcp_instructions.md`, документы из этого каталога и approved templates.
