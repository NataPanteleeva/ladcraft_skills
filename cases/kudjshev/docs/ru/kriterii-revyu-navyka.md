# Pre-publish checklist для навыка `cursor_ladcraft`

Используйте этот документ как финальный gate перед local run и publish.

Связанные документы:

- [Формат навыка](rukovodstvo-navyki-ladcraft.md)
- [Функции tool (native handler)](skill-function-tutorial.md)
- [Миграция навыка](migraciya-navykov-ladcraft.md)

## 1. Структура папки

- [ ] Есть `skills/<skill_name>/SKILL.md`.
- [ ] Определён режим навыка: `instruction-only` или `tool-based`.
- [ ] Для `tool-based` для каждого tool есть пара `scripts/<tool>.js` и `scripts/<tool>.meta.md`.
- [ ] Если нужен widget, есть `widgets/<widget>.MD`.
- [ ] Если widget использует client-side JS, он вынесен в `scripts/<widget>.widget.js` и подключён через `scriptRefs`.

## 2. Согласованность имён

- [ ] Для `tool-based` `SKILL.md -> mcp_spec.tools[].name` совпадает с `scripts/*.meta.md -> name`.
- [ ] Basename файлов совпадает с именами tool/widget.
- [ ] Для `tool-based` prompt навыка не упоминает tools, которых нет в папке навыка.
- [ ] Для `instruction-only` prompt не делает вид, что внутри пакета есть локальные tools.

## 3. `SKILL.md`

- [ ] В frontmatter заполнены `name` и `description`.
- [ ] Если нужен `environment`, он задан только в `mcp_spec.tools[].environment`.
- [ ] Если нужны явные capabilities, они заданы в `mcp_spec.default_capabilities.required`.
- [ ] Тело prompt-а описывает реальные вызовы tool, а не platform/runtime-фантазии.

## 4. `*.meta.md`

- [ ] Для `tool-based` у каждого tool заполнены `name`, `description`, `schemas` и `resources`.
- [ ] Для `tool-based` `resources.timeout` задан в секундах.
- [ ] Для `tool-based` `resources.network.hosts` содержит все реально используемые внешние хосты.
- [ ] `*.meta.md` не используется как источник истины для `environment`.

## 5. Скрипты

- [ ] Для `tool-based` каждый `scripts/<tool>.js` содержит **только** `async function handler(state, params)` как публикуемый контракт (без целевого «local-style» без `handler`).
- [ ] Для `tool-based` VFS/KV используются через `state.capabilities` и контракт Ladcraft (см. шаблоны и `skill-function-tutorial.md`).
- [ ] Для `tool-based` нет `require`, `import`, `module.exports`.
- [ ] Для `tool-based` код не предполагает несуществующий базовый контракт вроде `skillStorage.clear()` или произвольный набор VFS-методов без явного capability.
- [ ] Для `tool-based` примерные вызовы в prompt совпадают со schema инструмента.

## 6. Виджеты

- [ ] Связка tool ↔ widget согласована через meta / `widgets/*.MD` и фактические данные, которые возвращает `handler` (без legacy-хвостов VM-bootstrap).
- [ ] В `widgets/*.MD` используется EJS/HTML, а не Handlebars blocks.
- [ ] Данные для виджета согласованы с output-схемой tool.
- [ ] Все внешние `<script src>` / `<link href>` покрыты `resources.network.hosts`.

## 7. Known bad patterns

Перед publish убедитесь, что навык не содержит:

- [ ] Для `tool-based` обход контракта: произвольные прямые runtime-вызовы VFS без согласования с `state.capabilities` и каноном (см. anti-patterns)
- [ ] Handlebars blocks в widget
- [ ] `environment.user/app` в meta как основной контракт
- [ ] ссылки на `delegateToAgent`, `runDialog`, `workspace(...)`, `skills activate ...` и другие ghost tools
- [ ] Для `tool-based` prompt, который требует tool-ы вне `mcp_spec.tools[]`
- [ ] Для `instruction-only` prompt, который притворяется владельцем локальных tools

## 8. Финальный self-check

Перед publish ответьте `да` на все вопросы:

1. Это `instruction-only` или `tool-based` навык?
2. Если это `tool-based`, `mcp_spec.tools[].name` совпадает с meta/script?
3. `environment` задан только в `SKILL.md`?
4. Если это `tool-based`, в каждом `scripts/*.js` только native `handler(state, params)` и допустимые вызовы по контракту?
5. Если есть widget, он не использует Handlebars block syntax?
6. Если есть внешние хосты, `resources.network.hosts` покрывает их все?
7. Если это `tool-based`, prompt не требует tool-ов, которых нет в папке навыка?
8. Если это `instruction-only`, prompt не делает вид, что внутри пакета есть локальные tools?
9. Если это `tool-based`, примерные вызовы в тексте совпадают со schema инструмента?

Если хотя бы один ответ `нет`, навык не готов к publish.
