# AGENTS.md — ladcraft-r7_new

Плагин для кейса **LCA** ([`cases/LCA/`](../../LCA/)). База — btn_stream + tool_calls-first + `r7.event`.

## Сначала прочитай

1. [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)
2. [docs/03-apply-rules.md](docs/03-apply-rules.md) — precedence + event
3. [docs/04-skill-output-contract.md](docs/04-skill-output-contract.md)
4. R7 API: [`cases/knowledge-base/r7-api-handoff/07-plugin-integration.md`](../../knowledge-base/r7-api-handoff/07-plugin-integration.md)

## Границы

| Задача | Менять | Не трогать |
|--------|--------|------------|
| VFS / snapshot / mentioned.files | `src/transfer/` | task-runner |
| Чат / SSE / feedback send | `src/main.ts`, `src/eai/`, `src/utils/message-text.ts` | transfer shape |
| tool_calls / apply / r7.event | `src/apply/` | transfer upload path |

## Инварианты new

- `extractTasksFromReply`: tool_calls **до** fence.
- Feedback только через `sendApplyFeedbackQuiet` (не `handleSend`).
- Не показывать ```r7.event``` в user bubble.
