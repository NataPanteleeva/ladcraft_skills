# Блок 3: Обработка ответа и вставка в R7

> **ladcraft-r7_new / LCA:** WHAT/WHERE из **`r7.proposal/v1`**. Apply **без** хода к агенту. Markdown `Черновик:` — узкий legacy-fallback; free-text / summary heuristics **нет**.

## Ответственность

- Intent-apply: «вставь» / «да» / «замени…» / «исправь все|N» → Asc из **proposal.text**
- Proposal хранится в `ChatMessage.applyText` (UI `text` санитизирован и fence не показывает)
- Нет proposal: контролируемый **markdown-fallback** (Черновик / structured summary / «вставь текст»|позиция курсора → last reply) → `paste_text` + MD→HTML
- Нет proposal и текст не insertable («Читаю контекст…») → статус + **отправка агенту** с пометкой «повтори с r7.proposal»
- Успешный apply / нет выделения → **blocked/applied**, агенту не слать
- После успешного apply: статус в UI, **не** `sendUserMessage`, **не** `r7.event`, **не** wait агента
- Резолвер задач из `tool_calls` (fallback, когда агент всё же вызвал write-tools)

## Precedence inbound

0. **User intent** на send (`tryIntentApplyFromUserText`) — proposal → Asc → early return
1. Иначе: VFS sync + agent turn
2. После ответа агента: `parseToolCalls` / `r7.task` auto-apply (dedupe)

## Guards

- Bare «вставь» без Черновик/summary/proposal → `missing-proposal` (не вставлять «всё окно» / «читаю контекст»)
- «вставь текст» / «в позицию курсора» / «вставь это» → markdown-fallback last insertable reply
- «замени выделенный / абзац / на предложенный текст» → `replace_selection` (из proposal или fallback)
- `replace_selection` без выделения → статус «выделите фрагмент…»
- Короткое «да» после findings → не apply (нужно «исправь…»)

## UI

V4 action bar над composer: шильдик «Действия» + всплывающая икон-полоска (локальный Asc/download, без агента). Повторный клик по вставке **не** блокируется dedupe («Уже применено») — только intent-apply и auto tool apply. Верх — компактные иконки + статус с hover.

**Cell:** после bulk `SetValue` (кнопки «Лист» / «Вставить» / «Заменить») — канон redraw viewport: отдельный `callCommand` с `FreezePanes.Unfreeze` + `Select(A100→home)` + `AutoFit` / `Recalculate` (**не** блокирует unlock UI; ≥ `0.6.61`). Завершение действия = callback **записи**, не таймаут. Подробно: [TABLE-AGENTS-PLUGIN.md](TABLE-AGENTS-PLUGIN.md).

## Код

| Путь | Назначение |
|------|------------|
| `src/apply/proposal-parse.ts` | r7.proposal/v1 |
| `src/apply/intent-apply.ts` | user phrase → plan |
| `src/apply/task-runner.ts` | Asc apply |
| `src/apply/editor-methods.ts` | Word paste + Cell matrix write / `nudgeCellViewportAfterWrite` |
| `src/main.ts` | tryIntentApplyFromUserText + early return |

## См. также

- [04-skill-output-contract.md](04-skill-output-contract.md)
- Агент: [`cases/LCA/`](../../LCA/)
