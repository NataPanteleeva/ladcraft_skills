# r7-document-compare-v2 — approved snapshot (instruction-only)

**Тег:** `compare-r7-v2`  
**Статус:** approved (2026-06-29)  
**Prod agent:** `tc04UdOHJpv0YYKJjLbF8`

> **Pre-monolith:** полный снимок 3 навыков — [`r7-document-compare-v2-3skills`](../r7-document-compare-v2-3skills/).  
> После monolith — см. [`r7-document-compare-v2-monolith`](../r7-document-compare-v2-monolith/) (если создан).

## Суть

Объединяет:

1. **File I/O «Сравнение 27»** — agent `bash head` на `/session/r7/` (peek 8k на START, full read на COMPARE)
2. **Точность templates+compare** — LLM semantic + `r7.task` CompareReport `doc-compare/v1`
3. **Export compare-r7** — `r7_render_and_deliver_docx`

## Чеклист приёмки

- [ ] START: ls + peek B + activate (3 tool), без COMPARE
- [ ] COMPARE: 2× bash head, без python / read_r7_snapshot_text
- [ ] Ответ: markdown + `r7.task` doc-compare/v1
- [ ] EXPORT: `r7_render_and_deliver_docx`
- [ ] Read &lt; 15 с, полный COMPARE &lt; 2 мин

См. ADR-005 в [`architecture-decisions.md`](../../compare-r7/docs/architecture-decisions.md).
