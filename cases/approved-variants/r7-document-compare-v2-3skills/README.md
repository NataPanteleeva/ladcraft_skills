# r7-document-compare-v2-3skills — pre-monolith backup

**Статус:** approved snapshot (pre-monolith)  
**Снято:** 2026-06-29  
**Источник:** `cases/compare-r7_v2/` (3 навыка + agent instruction)

Полный снимок **до** агрессивной оптимизации (monolith skill). Используй для отката на prod.

## Prod IDs (на момент снимка)

| Сущность | ID / slug |
|----------|-----------|
| Агент | `tc04UdOHJpv0YYKJjLbF8` |
| r7-compare-toolkit-v2 | `TiJiaM2vsVqmvqTAofwZA` |
| doc-compare-v2 | `WPzlNroFg9z16bwBAnoBL` |
| r7-docx-render-v2 | `8QKNjjqbYTmK212Za_pu6` |

## Откат

1. `skill-update` по payloads в `payloads/` для трёх навыков.
2. `agent-bind` все три skill app_id на агент `tc04UdOHJpv0YYKJjLbF8`.
3. `agent-patch` — `agent/instruction` из этого снимка.

См. `docs/pre-monolith.md` — закреплённые ADR.

## Что в снимке

- `agent/instruction` — полная instruction (transport + policy ссылки)
- `skills/` — SKILL.md + scripts (toolkit, doc-compare, r7-docx-render)
- `payloads/` — build_payload.json для publish
