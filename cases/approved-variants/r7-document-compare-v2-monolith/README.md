# r7-document-compare-v2-monolith

**Тег:** `compare-r7-v2`, `monolith`  
**Статус:** approved (2026-06-29)  
**Prod agent:** `tc04UdOHJpv0YYKJjLbF8`

Один навык **doc-compare-v2** вместо toolkit + doc-compare + docx-render.

## Архитектура

- START: ls + activate doc-compare-v2
- COMPARE: 2× head → persist → slim r7.task
- EXPORT: 1× r7_render_and_deliver_docx(reportPath)

ADR-007/008. Откат 3 skills: [`r7-document-compare-v2-3skills`](../r7-document-compare-v2-3skills/).
