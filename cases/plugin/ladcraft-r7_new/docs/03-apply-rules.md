# Блок 3: Обработка ответа и вставка в R7

> **ladcraft-r7_new / LCA:** однократная вставка/замена — **plugin intent** (`intent-apply.ts`); пакетные правки — `tool_calls`; fence `r7.task` = fallback. После apply — quiet ```r7.event```.

## Ответственность

- Intent-apply по фразам «вставь» / «да» / позиция → Asc (не ждёт skill)
- Резолвер задач из `tool_calls` (primary для search_replace/cell) и `r7.task` (fallback)
- Авто-применение editor tasks + feedback `r7.event`

## Precedence inbound

0. **User approval intent** на send (`tryIntentApplyFromUserText`) — paste / replace_selection / add_comment + position start|end|cursor
1. `parseToolCalls(message.tool_calls)` — имена `r7_paste`, `r7_search_replace`, …
2. Fenced / inline `r7.task` — без коллизии fingerprint

Дедуп intent и tool: `content:{type}:{JSON(data)}` в `appliedKeys`.

## Авто-применение (task-runner)

| `type` | Авто-применение |
|--------|-----------------|
| `search_replace`, `add_comment`, `paste`, `paste_text`, `cell_paste`, `remove_selection` | **да** |
| `replace_selection` | **да** (строка payload; пустой текст → отказ без удаления выделения) |
| `deliver_file`, `deliver_inline`, `share_link`, `open_file` | **нет** (UI / export) |

Дедупликация: `sessionStorage` `ladcraft_r7_applied_tasks:{sessionId}`.

## Feedback `r7.event` (new)

После apply (`tryApplyEditorTasksFromHistory`):

1. Собрать payload `schema: r7.event/v1`, `kind: apply_result` (`src/apply/apply-feedback.ts`).
2. `sendMessage` с content = fence ```r7.event``` — **без** `prepareOutbound` / optimistic bubble.
3. User-строка скрыта в UI (`isServiceFeedbackContent` / `stripUserMessageSupplements`).
4. Dedupe notify keys: `ladcraft_r7_event_notified:{sessionId}`.
5. Anti-loop: `isServiceFeedbackInFlight`; агент не должен re-apply те же ops.

## Когда показывать блоки insert/download

Intent-gated (`вставить` / `скачать`) — наследие btn_stream; см. [04-skill-output-contract.md](04-skill-output-contract.md). Для LCA основной путь — auto-apply editor tools.

## Код

| Путь | Назначение |
|------|------------|
| `src/apply/executor.ts` | tool_calls first |
| `src/apply/tool-call-parser.ts` | имя tool → R7Task |
| `src/apply/task-runner.ts` | apply в редактор |
| `src/apply/apply-feedback.ts` | r7.event payload |
| `src/main.ts` | tryApply + sendApplyFeedbackQuiet |
| `src/utils/message-text.ts` | strip event в user UI |

## См. также

- [04-skill-output-contract.md](04-skill-output-contract.md)
- Агент: [`cases/LCA/`](../../LCA/)
