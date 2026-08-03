# Samples README — что реально приходит (discovery 2026-07-30)

Снято харнессом [`scripts/spike-projection.js`](../../scripts/spike-projection.js).  
Папки: `lca-20260730-104554/`, `excel-20260730-104634/`.

## Файлы в каждой папке

| Файл | Содержание |
|------|------------|
| `00-meta.json` | Краткие сводки stream/projection |
| `01-stream-events.json` | Полный SSE AG-UI |
| `02-projection.json` | `GET /v2/agent/thread/{id}/projection` |
| `03-history-v1-compare-only.json` | v1 history **только для сравнения**, не целевой канон |

## Excel (кнопки) — главный вывод

**Полный skill JSON (`userReply`, `targetPath`, `ok`, `stop`) НЕ лежит в `projection.tools[].result` и НЕ в stream `TOOL_CALL_RESULT`.**  
Там только краткий текст вроде `"Выполнил top n summary"`.

Полный result **есть** в projection, но глубже:

- `runs[].projection.state.runtimeTimeline.events[].data.result` → `userReply`, `targetPath`, …
- `runs[].projection.activities[].content.events[].result` → то же

| Источник | Что видно для analytics tool |
|----------|-------------------------------|
| v1 history `tool_calls[].result` | Полный JSON (сравнение) |
| Stream / projection `tools[].result` | Урезанный summary |
| `state.runtimeTimeline` / `activities` | **Полный** `userReply` + `targetPath` |
| CUSTOM / `responseFileReferences` | `file_id`, path, display_name — удобно для кнопок скачивания |
| Текст ассистента | Строка `Файл: /session/….xlsx` |

### Следствие для архитектуры кнопок (без history)

Предпочтительный простой путь:

1. **Файл / download** ← `responseFileReferences` / `eai.message.file_references` (`file_id`).
2. **Текст bubble** ← `TEXT_MESSAGE_*` / text `orderedBlocks`.
3. Early unlock ← `file_references` в стриме.

Запасной путь, если нужен именно structured skill payload: парсить `activities` / `runtimeTimeline` (не `tools[]`).

Не строить кнопки из `projection.tools[].result` — там нет `userReply`.

## LCA (proposal / apply)

| Источник | Что |
|----------|-----|
| Tools в projection | `readFile`, `skills` (activate `lca-proofread`) — без write-tools |
| Текст ассистента | Таблица замечаний + fence **`r7.proposal`** (`kind: findings`) |
| Apply | Как сейчас: из **текста** proposal, не из tool result |
| Terminal | `interrupt` / `waiting_user_response` (ждёт «исправь все») |

Для LCA достаточно текста стрима + text blocks projection; `tools[]` почти не нужны для кнопок apply.

## Общие поля projection (оба прогона)

```
runs[].run_id
runs[].last_applied_seq
runs[].projection.messages[]   // role, id, orderedBlocks[], responseFileReferences?
runs[].projection.tools[]      // id, name, status, arguments, result (урезанный)
runs[].projection.terminal     // status, outcome (success | interrupt | …)
```

`orderedBlocks`: `text`, `tool_group`, …  
Retry по `last_applied_seq` в обоих прогонах не понадобился (seq сразу совпал).

## Как переснять семплы

```bash
node cases/plugin/ladcraft-r7_agui/scripts/spike-projection.js
node cases/plugin/ladcraft-r7_agui/scripts/spike-projection.js --only excel
```
