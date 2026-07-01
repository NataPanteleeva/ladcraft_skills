# Блок 2: Отработка сообщений чата

> Отдельный план. Заглушка границ — не смешивать с блоком 1.

## Ответственность

- Сессия Ladcraft (`createSession`; `deleteSession` — только явное удаление, не при закрытии панели)
- `POST /message` / poll history
- Виджеты уточнения, отображение bubble
- `waitForAssistantTurn`, статусы «ожидание»

## Не входит

- Формат snapshot, VFS upload (блок 1)
- `r7.task`, вставка в R7 (блок 3)

## Правила (кратко)

- Закрытие панели / «Назад» / смена агента: **только** сброс localStorage (`clearSessionForDoc`, `clearDocumentContext`) и in-memory state; **не** вызывать `DELETE /v1/agent/session/{id}` — сессия остаётся на сайте Ladcraft
- Новое открытие чата: `createSession` (POST) — новая сессия в плагине; предыдущие сессии на сайте сохраняются
- Перед send вызывать `prepareOutbound` из блока 1 — не дублировать VFS-логику в `main.ts`
- Widget submit → тот же `handleSend` → снова `mentioned.files`
- Bubble пользователя — только видимый текст; selection supplement только в API `content`

## Ожидание ответа (фаза 1 — poll-only)

Плагин **не** использует SSE; только REST poll `GET /v1/agent/session/{id}/history`.

### Две фазы

1. **Активное ожидание** (`waitForAssistantTurn`) — каждые 1.2 s после POST, пока `isAssistantReplyReady`.
2. **Фоновый poll** (`tickHistorySync`) — 1.2 s (compare) / 2.5 s после завершения send; подтягивает late-reply без повторной отправки.

### Таймауты

| Константа | Значение | Когда |
|-----------|----------|--------|
| `DEFAULT_ASSISTANT_WAIT_MS` | 5 мин | «привет», выбор без compare |
| `COMPARE_ASSISTANT_WAIT_MS` | 10 мин | выбор шаблона из последней таблицы ассистента (`.md`, stem без `.md`, `№N` / номер строки) или `isAwaitingCompareReport` в history |
| `STALL_FALLBACK_MS` | 2 мин | fallback, если tools завершены, текста нет, API не шлёт terminal status |

Выбор timeout: `resolveAssistantWaitTimeoutMs(userText, rawHistory)` в `session.ts`.  
Compare-ход определяется через `resolveTemplateSelection` (`src/transfer/template-selection.ts`) — **без whitelist имён**; источник — последний picker ассистента.

### Отображение vs API

`sanitizeAssistantChatText` (`display-sanitize.ts`) скрывает JSON compare report **только в bubble**; на `POST /message`, poll и block 3 не влияет.

### STALL_FALLBACK при compare

`shouldSuppressStallFallback` **отключает** 120 s fallback, если:

- в history interim compare («Сравниваю…») — `isAwaitingCompareReport`;
- в текущем ходе pending или завершённые compare-tools (`head -c`, `compare_with_template`, …).

Иначе возможен ложный обрыв между batch tool calls и финальным markdown.

### Late-reply (после timeout активного wait)

- Статус: «Ответ задерживается — загружаем из чата…»
- `isSending = false` — send разблокирован
- Фоновый poll продолжается; отчёт появится в UI, когда Ladcraft допишет history

### Готовность хода (`isAssistantReplyReady`)

> **Схема v2 (2026-06-29).** Статус успешности на проде — TBD.  
> Не накапливать interim-regex; один gate + отдельный display-sanitize.

#### Принцип

Ход **готов**, когда в history есть **содержательный** ответ пользователю — не «любой непустой текст».

#### Методы (цепочка)

| Шаг | Модуль | Функция | Назначение |
|-----|--------|---------|------------|
| 1 | `session.ts` | `extractVisibleText` | Текст для wait и bubble: timeline `kind=text` (без `reasoning`); если `content` длиннее и substantive — предпочесть `content` |
| 2 | `content-extract.ts` | `isTemplatePickerMessage` | Таблица шаблонов (`\| Шаблон \|` / `\| Название \|`), «какой шаблон…» — ход 1 готов |
| 3 | `content-extract.ts` | `isSubstantiveResult` | Отчёт compare (`**Расхождений: N**`), длинный текст ≥120; исключает picker |
| 3b | `content-extract.ts` | `isComparisonReport` | Подмножество substantive; маркер завершения compare |
| 3c | `content-extract.ts` | `isTemplateBodyDump` | Дамп TT из bash `head` — **не** мержить в visible |
| 4 | `session.ts` | `isRenderableAssistantText` | `picker \|\| substantive` — единый gate |
| 5 | `session.ts` | `isAssistantReplyReady` | Widget / stall / terminal + `isRenderableAssistantText` |
| 6 | `display-sanitize.ts` | `sanitizeAssistantChatText` | **Только UI bubble:** JSON compare, tool JSON, base64, r7.task |
| 7 | `chat-history.ts` | `historyToChatMessages` | `extractVisibleText` → sanitize → bubble |

#### Что не показываем в bubble

| Данные | Как отсекается |
|--------|----------------|
| Размышления (`kind: reasoning`) | `extractVisibleText` — только `kind=text` |
| invoke/XML tool markup (`<invoke>`, `<minimax:tool_call>`, `<tool_call>`) | `stripAgentServiceMarkup` в `extractVisibleText` и `sanitizeAssistantChatText` |
| doc-compare JSON | `sanitizeAssistantChatText` |
| Tool JSON / `file_id` / `content_base64` | `sanitizeAssistantChatText` |
| Длинные base64-строки | `LONG_BASE64_LINE_RE` |
| Скачивание .docx | `docx-from-tools` → кнопка, не текст; `download.ts` + `sanitizeExportContent` для .md/.html |

#### Compare-ход

- Выбор шаблона: [`template-selection.ts`](src/transfer/template-selection.ts) — `resolveTemplateSelection`, outbound `*.md`
- Ожидание: `isCompareTurnRequest` → timeout 10 min; `isAwaitingCompareReport` пока нет `isComparisonReport` после last user
- Interim («Сравню шаблон…») — **не** `isSubstantiveResult` → wait продолжается
- STALL_FALLBACK при compare: `shouldSuppressStallFallback`

#### Не готов / готов (кратко)

Не готов: pending tools, streaming, interim без отчёта, tools done но message не terminal.  
Готов: `isRenderableAssistantText`, widget, terminal stall без текста.

## Фаза 2 (не реализовано) — запасной вариант

Если poll-only снова даёт расхождения с веб-Ladcraft (обрывы, ложный stall, compare > 10 min):

**Гибрид SSE + history** (`GET /v1/agent/sse/{session_id}`):

- SSE — сигнал «ход в процессе / завершён» (как веб-UI)
- Один `GET history` на terminal — полный payload (`tool_calls`, CompareReport, block 3)
- Poll history — fallback, если SSE нед недоступен в R7 WebView

Spike перед внедрением: Bearer auth, reconnect, EventSource в embedded panel.

## Код

- `src/main.ts` — оркестратор, `resolveAssistantWaitTimeoutMs` при send
- `src/transfer/template-selection.ts` — match шаблона из таблицы, normalize outbound `*.md`
- `src/eai/session.ts` — transport, wait/stall logic
- `src/apply/content-extract.ts` — `isSubstantiveResult`, `isTemplatePickerMessage`, `isComparisonReport`, `isTemplateBodyDump`
- `src/apply/display-sanitize.ts` — sanitize bubble (не wait gate)
