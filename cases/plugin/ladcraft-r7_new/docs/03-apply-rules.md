# Блок 3: Обработка ответа и вставка в R7

> **ladcraft-r7_new / LCA:** WHAT/WHERE из **`r7.proposal/v1`** + user intent; markdown `Черновик` — fallback. После apply — quiet ```r7.event```.

## Ответственность

- Intent-apply: «вставь» / «да» / «исправь все|N» / позиция → Asc из proposal
- Резолвер задач из `tool_calls` (fallback) и `r7.task`
- Авто-применение editor tasks + feedback `r7.event`

## Precedence inbound

0. **User intent** на send (`tryIntentApplyFromUserText`) — proposal → tasks (blob / findings / cell / comment)
1. `parseToolCalls(message.tool_calls)` — имена `r7_paste`, `r7_search_replace`, …
2. Fenced / inline `r7.task` — без коллизии fingerprint

Дедуп: `content:{type}:{JSON(data)}` + `intent:findings:rN:ids` в `appliedKeys`.

## Guards

- Нет proposal и нет **Черновик** → не вставлять «всё окно»
- `replace_selection` / comment без выделения → статус «выделите фрагмент…», без paste
- Короткое «да» после findings → не apply (нужно «исправь…»)

## Авто-применение (task-runner)

| `type` | Авто-применение |
|--------|-----------------|
| `search_replace`, `add_comment`, `paste`, `paste_text`, `cell_paste`, `remove_selection`, `replace_selection` | **да** |
| `deliver_*`, `share_link`, `open_file` | **нет** |

## Feedback `r7.event`

После apply: quiet fence `r7.event/v1` `apply_result`. Агент не re-apply.

## Код

| Путь | Назначение |
|------|------------|
| `src/apply/proposal-parse.ts` | r7.proposal/v1 |
| `src/apply/intent-apply.ts` | user phrase → plan |
| `src/apply/task-runner.ts` | Asc apply |
| `src/apply/display-sanitize.ts` | strip proposal/event/task |
| `src/main.ts` | tryIntentApplyFromUserText |

## См. также

- [04-skill-output-contract.md](04-skill-output-contract.md)
- Агент: [`cases/LCA/`](../../LCA/)
