# Pre-monolith — закреплённые инварианты

Снимок **до** monolith `r7-document-compare-v2`. Эти правила **не отменяются** при оптимизации.

| ADR | Инвариант |
|-----|-----------|
| ADR-001 | COMPARE read — agent `bash head`, не skill VFS |
| ADR-002 / ADR-005 | START: 2 tool, B не читать |
| ADR-003 | Видимый markdown + `r7.task` deliver_inline |
| ADR-006 | 2× head; запрет post-read bash |
| Plugin contract | Intent-gated closing; `doc-compare/v1` |

Отвергнуто: peek B на START, `compare_documents` на prod, python pipe на session.

См. [`architecture-decisions.md`](../../../compare-r7/docs/architecture-decisions.md).
