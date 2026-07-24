# compare-r7 v2 — monolith (ADR-007/008)

> **Канон:** один skill **doc-compare-v2**; START `ls` + activate; COMPARE 2× head → persist → slim `r7.task`; EXPORT 1× render.  
> **Откат:** [`approved-variants/r7-document-compare-v2-3skills/`](../approved-variants/r7-document-compare-v2-3skills/).

## Prod

| Сущность | id |
|----------|-----|
| Агент v2 | `tc04UdOHJpv0YYKJjLbF8` |
| doc-compare-v2 (monolith) | `WPzlNroFg9z16bwBAnoBL` v**13.0.0** |

Legacy skills (deprecated, не bind): `r7-compare-toolkit-v2`, `r7-docx-render-v2`.

## Публикация

```bash
cd cases/compare-r7_v2
node publish_monolith.js
```

## Smoke

```bash
node smoke_first_turn.js
node smoke_test.js
```

Guards: `smoke_compare_guard.js` — COMPARE transport (2× head), closing phrases, EXPORT 1× render.  
Smoke prod (2026-06-29): `smoke_test.js` PASS; `export_deliver_ok` может быть false в headless (VFS upload).

**Известное:** `r7_persist_compare_report` на prod иногда таймаутит VM — EXPORT использует fallback `report` / `r7.task` deliver_inline.

## Код

- Monolith skill: `skills/r7-document-compare/`
- Agent router: `agent/instruction` (~50 строк)
- ADR: [`architecture-decisions.md`](../compare-r7/docs/architecture-decisions.md) ADR-007, ADR-008
