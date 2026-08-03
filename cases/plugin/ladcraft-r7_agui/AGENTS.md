# AGENTS.md — ladcraft-r7_agui

Плагин-форк **ladcraft-r7_new** с транспортом **AG-UI**. Целевые агенты для проверки — текущие LCA / excel (как в `_new`).

## Сначала прочитай

1. [README.md](README.md)
2. [_future-server-agents/README.md](_future-server-agents/README.md)
3. Канон родителя: [../ladcraft-r7_new/docs/ARCHITECTURE.md](../ladcraft-r7_new/docs/ARCHITECTURE.md)
4. Протокол: [`cases/knowledge-base/AG‑UI/AG-UI.md`](../../knowledge-base/AG‑UI/AG-UI.md)

## Границы

| Задача | Менять | Не трогать |
|--------|--------|------------|
| AG-UI run / stream | `src/eai/ag-ui-*.ts`, `transport.ts`, `main.ts` send | prod `ladcraft-r7_new` |
| VFS / disk-ref | `src/transfer/` (как в _new) | без смены контракта агентов на этом этапе |
| Apply / proposal | `src/apply/` | без AG-UI surfaces |

## Инварианты AG-UI

- `runId` / `messages[].id` — nanoid-like (21), **не** UUID с дефисами.
- После `RUN_FINISHED` — history sync для tool_calls / proposal / excel deliverables.
- CUSTOM: `eai.message.draft.*`, `eai.message.text.replaced`.
- Cancel: `POST /v2/agent/run/{runId}/cancel` (abort fetch недостаточен).
