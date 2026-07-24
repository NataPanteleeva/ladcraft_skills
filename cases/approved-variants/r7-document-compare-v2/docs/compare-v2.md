# compare-r7 v2 — templates+compare START + LLM + docx

> **START:** `bash ls` + `activate` (2 tool), B **не читать**.  
> **COMPARE:** 2× bash head → LLM + `r7.task` (transport фиксирован, ADR-006).  
> **Policy:** настраивается в `doc-compare-v2` — раздел **Policy по умолчанию**.  
> **EXPORT:** `r7_render_and_deliver_docx`.

## Prod

| Сущность | id |
|----------|-----|
| Агент v2 | `tc04UdOHJpv0YYKJjLbF8` |
| r7-compare-toolkit-v2 | `TiJiaM2vsVqmvqTAofwZA` |
| doc-compare-v2 | `WPzlNroFg9z16bwBAnoBL` |

## Архитектура (ADR-006)

| Слой | Где |
|------|-----|
| Transport | `agent/instruction`, `r7-compare-toolkit-v2` — 2× head, 0 tool после batch |
| Policy | `doc-compare-v2/SKILL.md` — ignore, severity, section_priority |

Post-read диагностика (`wc`, `python`, `find` после `head`) — **запрещена** (ложные «snapshot не найден»).

## Отличие от v2.0 (отозвано)

Peek B на START (`head -c 8000`) — **убрано** (ADR-005).

## Публикация

```bash
cd cases/compare-r7_v2
node publish_update_v2.js
```

## Smoke

```bash
node smoke_first_turn.js   # 2 tool: ls + activate
node smoke_test.js         # COMPARE transport guard (smoke_compare_guard.js)
```
