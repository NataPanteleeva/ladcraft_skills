# Проект для создания навыков Ladcraft (`cursor_ladcraft`)

Локальное окружение для разработки, тестирования и публикации навыков Ladcraft.

Корневой README намеренно короткий: главный operational router находится в `mcp_instructions.md`, а подробные гайды и критерии ревью вынесены в `docs/ru/`. Ниже — только входная точка и быстрый старт.

## Источник документации

Единая модель документации такая:

- `mcp_instructions.md` — главный operational router;
- `docs/ru/*.md` — подтверждающие reference docs;
- `docs/ru/skill_templates/*` — approved few-shot templates и anti-patterns.

## Формат навыка

Текущий рабочий формат в `skills/<skill_name>/`:

- `SKILL.md` — frontmatter + markdown-body промпта навыка;
- `scripts/<tool_name>.js` — **только** нативный Ladcraft handler: `async function handler(state, params) { ... }`;
- `scripts/<tool_name>.meta.md` — frontmatter метаданных инструмента.

Возможен и `instruction-only` формат: только `SKILL.md`, без `scripts/` и `widgets/`.

Формат без `handler` (legacy local-style с `input` / `returnResult` и т.п.) **не является** целевым; такой код при миграции переводится в `handler` (см. `docs/ru/migraciya-navykov-ladcraft.md`).

Для новых навыков ориентируйтесь на `mcp_instructions.md` и `docs/ru/skill_templates/*`, а не на произвольные папки в `skills/`.

## Быстрый старт

1. Открой `cursor_ladcraft` в Cursor.
2. Проверь `.cursor/mcp.json` (`mcpServers["skilled-agent"].disabled: false`).
3. Запусти:
   - `npm --prefix dev-server install`
   - `npm --prefix dev-server run dev`
4. Открой `http://localhost:5174`.

## Автообновление bundle

Если в UI показан баннер обновления `cursor_ladcraft`, можно нажать кнопку `Обновить`:

- архив скачивается и применяется автоматически через launcher;
- dev-server/web-ui перезапускаются (или получают reload в dev-режиме) без ручного reopen проекта;
- локальная папка `skills/` сохраняется и не входит в backup/update, поэтому черновики не теряются;
- папка `user-data/` сохраняется и не входит в backup/update: используйте её для любых рабочих файлов;
- корневая папка `.git` не удаляется при update/rollback.

Legacy-паттерны и старый `local-style` описаны только в migration/reference-доках внутри `docs/ru/`, как входной формат для конвертации в canonical handler.
