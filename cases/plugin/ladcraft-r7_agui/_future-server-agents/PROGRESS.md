# PROGRESS — уход с history на projection

Живой журнал шагов. Обновлять после каждого этапа, чтобы не терять контекст.

## Цель

Канон для новых AG-UI сессий: стрим + `GET /v2/agent/thread/{id}/projection`.  
v1 history не используем. Legacy-сессии не поддерживаем.  
Адаптер «вслепую» не пишем — сначала семплы с LCA и Excel.

## Статус

| Этап | Статус | Дата |
|------|--------|------|
| 0. Харнесс `spike-projection.js` | **done** | 2026-07-30 |
| 0b. Прогон LCA + Excel → samples | **done** | 2026-07-30 |
| 0c. Шпаргалка `samples/README.md` | **done** | 2026-07-30 |
| 1. Модель данных `MODEL-FROM-SAMPLES.md` | **done** | 2026-07-30 |
| 2. Реализация в ladcraft-r7_agui | **done (код)** | 2026-07-30 |

## Agent IDs (prod)

- LCA: `f5BwCaKDeDDG71zHJPvid`
- Excel Pivot: `UsL7iqdQLBtYpmP0s7dWF`

## Фаза 2 — что сделано в коде

| Компонент | Файл / поведение |
|-----------|------------------|
| Projection client | `src/eai/projection.ts` — get/wait/toChat/file refs |
| Sync / reopen | `main.ts` `loadProjectionFromServer` (agUiStreaming) |
| Wait turn | `waitForProjectionTurn` вместо v1 history wait |
| Stream file_refs | `ag-ui-run.ts` CUSTOM `eai.message.file_references` → early buttons |
| Excel deliverables | `agent-deliverables.ts` — `fileReferences` + `fileId` |
| LCA insert | `proposal.text` → иначе тело под `Черновик:` → иначе пусто (не full-chat) |
| Recovery Proposal button | **убрана** |
| Agent contract | prod: instruction + `lca-analyze` **v12** (Черновик + обязательный fence; жанр вне блоков) |

## Insert fallback (2026-07-30)

Кнопки / apply:
1. валидный `r7.proposal` → `sanitizeProposalText(proposal.text)`
2. иначе маркер `Черновик:` → только тело после заголовка
3. иначе substantive markdown-саммари (жанр/CTA срезаны) — иначе кнопок нет

Жанр / CTA в документ не попадают. Tiny meta-only ответ → без кнопок.

## User bubble: hide R7 context (2026-07-30)

`[Контекст R7: workbook|snapshot…]` уходит агенту, но **не** в UI: strip в projection, renderMessage, pending merge.

## Lexical replace → Asc (2026-07-30)

Диагноз: агент писал в VFS JSON («Заменено»), Word не менялся; AG-UI `rawHistory` пуст → tool apply мёртв.

Fix:
- `planLexicalSearchReplace` — literal «замени A на B» → Asc сразу + ack (без агента)
- findings после ответа агента на lexical → auto-apply
- `collectPendingSearchReplaceFromChat` для AG-UI
- `lca-proofread` v14: findings only, forbid snapshot rewrite

## Lexical «замени X на Y» (2026-07-30)

Баг: `APPROVAL_RE` ловил любое «замени…» → локальный paste последнего саммари → «Уже применено» без ответа в чате; запросы пропадали.

Fix:
- `isLexicalSearchReplaceIntent` → plan `null` → ход к агенту (proofread)
- bare «замени» / «замени выделенное» — по-прежнему local replace_selection

## Action bar persist + status-only apply (2026-07-30)

Баг: после клика «Курсор» `pushLocalApplyAck` добавлял `local-apply-*` → `resolveActionTarget` брал ack → кнопок нет.

Canon `_new`: после document apply **только** `chatStatus`; кнопки на draft модели; `allowRepeat` на bar.
- `executeDocumentApplyPlan` — status-only (без пузыря)
- `resolveActionTarget` — skip все `local-*`
- docs: `docs/03-apply-rules.md` UI
- smoke: `smoke-action-buttons.mjs` (persist), `smoke-paste-markdown.mjs` (MD→HTML + lists)

## Chat overwrite fix (2026-07-30)

Симптом: стрим с markdown/`**жирный**`, затем `eai.message.text.replaced` → короткий plain; кнопки пропадали вместе с Черновик/proposal.

Fix в `ladcraft-r7_agui`:
- `preferRicherOrAppend` — не затирать богатый текст коротким rewrite; дописывать только недостающие маркеры (Черновик/proposal)
- применено в `ag-ui-run` (`text.replaced`), `stream-orchestrator`, `mergePreservingStreamedAssistant`

Экспорт `…10-33-10…`: в history **нет** Черновик/proposal — только plain replacement. Кнопок не было по контракту; после фикса плагин сохранит стрим, если модель успела отдать разметку до replace. Prod: `lca-analyze` **v13** — любой саммари («о чём текст?») обязан Черновик+fence.

## Диагноз «нет proposal» (экспорт 08-54)

**Не потеря AG-UI.** В v1 history того же хода fence нет; кнопки `_new` = markdown-fallback.  
Транспорт projection/stream по этому кейсу **не копаем**. Fix = агент (Черновик+proposal) + plugin fallback только на Черновик.


## Smoke checklist (ручной)

1. **LCA + proposal:** жанр вне Черновика + fence → кнопки = `proposal.text` (без Жанр).
2. **LCA + Черновик без fence:** кнопки = только тело под Черновик.
3. **LCA без обоих:** insert-кнопок нет.
4. **Excel:** после `file_references` в стриме — XLSX/Лист/Вставить; download по `file_id`.
5. **Reopen чата:** projection восстанавливает bubbles + file refs без history.

## Ключевые находки (не потерять)

1. API-харнесс **достаточен** — пробный плагин R7 для формы JSON не нужен.
2. `projection.tools[].result` и stream `TOOL_CALL_RESULT` = **summary**, не skill JSON.
3. Полный `userReply` / `targetPath` в projection есть в `state.runtimeTimeline` и `activities`, плюс удобные **`responseFileReferences`** / CUSTOM `file_references` с `file_id`.
4. LCA apply: proposal в **тексте** assistant; tools только readFile/skills.
5. Для кнопок Excel целевой путь без history: **file_references + текст**, не `tools[]`.

Документы: [samples/README.md](samples/README.md), [MODEL-FROM-SAMPLES.md](MODEL-FROM-SAMPLES.md).
