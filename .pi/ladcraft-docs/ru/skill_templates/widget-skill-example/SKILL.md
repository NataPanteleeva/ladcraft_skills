---
name: widget-skill-example
description: Approved template для tool с widget и EJS (native handler).
mcp_spec:
  tools:
    - name: showStatusCard
---

# Widget skill example

Навык показывает, как tool возвращает данные в widget без Handlebars и без runtime-ghost tools.

## Что делать агенту

1. Вызвать `showStatusCard`.
2. Получить widget `statusCard`.
3. Не вызывать никакие дополнительные platform tools для рендера.
