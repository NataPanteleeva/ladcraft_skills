# Блок 2: Отработка сообщений чата

> Отдельный план. Заглушка границ — не смешивать с блоком 1.

## Ответственность

- Сессия Ladcraft (`createSession`; `abortSession` при новом входе; `deleteSession` — только явное удаление)
- `POST /message` / poll history
- Виджеты уточнения, отображение bubble
- `waitForAssistantTurn`, статусы «ожидание»

## Не входит

- Формат snapshot, VFS upload (блок 1)
- `r7.task`, вставка в R7 (блок 3)

## Правила (кратко)

- Закрытие панели / «Назад» / смена агента (локально): сброс localStorage (`clearSessionForDoc`, `clearDocumentContext`) и in-memory state; **не** `DELETE` сессии
- **Новое открытие чата** (`openChat` → `startNewChatSession`):  
  1. `GET /v1/agent/activity?only_active=true` + `POST /v1/agent/session/{id}/abort` для активных/ожидающих runs этого агента (и предыдущего session_id)  
  2. локальный detach  
  3. `createSession` (POST) — новый чат в плагине  
  История старых сессий **остаётся** на сайте Ladcraft (`abort` ≠ удаление). Так очередь агента не блокируется `waiting_approval` / `queued` из прошлого диалога.
- Перед send вызывать `prepareOutbound` из блока 1 — не дублировать VFS-логику в `main.ts`
- Widget submit → тот же `handleSend` → снова `mentioned.files`
- Bubble пользователя — только видимый текст; selection supplement только в API `content`

## Ожидание ответа (фаза 2 — text-only SSE + history)

Плагин использует гибрид:

- SSE для потокового текста ассистента (`message_start` / `content_delta` / `message_done`, live markdown render);
- один `GET /v1/agent/session/{id}/history` после `message_done` для финального payload (`tool_calls`, widget, actionPlan);
- poll history как fallback и для late-reply.

### Поток хода

1. Перед `POST /message` открывается SSE-подписка на сессию.
2. Во время стрима UI обновляет assistant bubble по `content_delta` (debounced patch, live markdown).
3. На `message_done` выполняется один sync history; список сообщений пересобирается из history (без дублирования bubble).
4. `waitForAssistantTurn` остаётся как gate/fallback (реже poll при активном SSE).
5. `tickHistorySync` остаётся фоновым механизмом для late-reply и режима без SSE.

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
| doc-compare JSON | `sanitizeAssistantChatText` (legacy compare report schema) |
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

#### Excel / analytics (Cell)

Ход **готов сразу**, когда tool result даёт `userReply` / `targetPath` (или в тексте есть `Файл: /session/….xlsx`) и нет pending tools — **не ждать** `message.status=completed`. Иначе bubble уже виден, а `isSending` держит кнопки («Ждём…»).  
Короткий `Файл:` считается substantive (`isSubstantiveResult`). Кнопки XLSX/Лист разблокируются при наличии deliverable даже до сброса `isSending`.  
Кнопка **Лист**: готовность = Asc `callCommand` callback записи (не «ждать N с»); watchdog ~12 с только если callback не пришёл. Viewport-nudge не блокирует unlock.

### Multi-turn / очередь перед send

Перед каждым `POST /message` (`handleSend`): **`ensureAgentQueueIdleBeforeSend`**.

| Abort | Когда |
|-------|--------|
| Любая сессия агента | activity `waiting_approval` / `queued` / `requires_user_action` |
| Текущая сессия | есть в active list (новый user turn прерывает leftover run) |
| Текущая сессия | последний assistant уже с analytics deliverable (даже если activity пуст) |
| После wait | analytics ready → `abortSession` текущего хода |
| Orphan (~16 с) | user в history, activity пуст, нет assistant → `finishPreviousAgentSessions` + повторный POST один раз («Повтор запуска хода…») |

История на сайте сохраняется (`abort` ≠ DELETE). См. [DATA-FLOW-CANON.md](DATA-FLOW-CANON.md) §7.1.

При успешном tool `userReply` + platform abort в `content` — bubble показывает **`userReply`** (`resolveAssistantDeliverableText`), не текст «Не удалось продолжить…».

## SSE transport и fallback

Рабочий endpoint на prod для плагина: `GET /v1/agent/sse/{session_id}` (`Authorization: Bearer`, `Accept: text/event-stream`).

Transport adapter: [`src/eai/transport.ts`](../src/eai/transport.ts) — `createChatTransport()` выбирает `SseHybridTransport` или `PollOnlyTransport` по feature flag `sseStreaming`. Низкоуровневый SSE parser: [`src/eai/sse.ts`](../src/eai/sse.ts). UI orchestration: [`src/eai/stream-orchestrator.ts`](../src/eai/stream-orchestrator.ts). AG-UI заглушка: [`src/eai/ag-ui-transport.ts`](../src/eai/ag-ui-transport.ts).

`/v1/agent-api/sessions/{session_id}/events` в текущем окружении возвращал `403`, поэтому используется как primary-кандидат в коде с автопереключением на `/v1/agent/sse/{session_id}`.

Fallback-правила:

- ошибка SSE connect/reconnect → poll-only для текущего send;
- `replay_reset` → один sync history и продолжение через poll;
- при активном SSE промежуточный `syncChatFromServer` внутри `onPoll` отключён, чтобы history не перетирал stream-дельты.

### Live markdown в stream

- Во время `content_delta` применяется тот же markdown renderer (`markdownToHtml`), что и в финальном bubble.
- `getStreamingVisibleText` скрывает служебную разметку (`r7.task`, tool JSON, base64, compare JSON) — в том числе незакрытые `` ```r7.task `` fence и частичный inline task JSON; пустой bubble заменяется на «Агент выполняет запрос…» с фиолетовым спиннером (анимация `#7c3aed` → `#c4b5fd` / `#ede9fe`).
- Markdown-таблицы в stream не показываются: `getStreamingVisibleText` режет текст от первой строки `| ... |`; таблица появляется только после `message_done` + `history` sync.
- Размышления (`reasoning`) в stream отдельно не фильтруются в этой фазе.

## Код

- `src/main.ts` — оркестратор, `resolveAssistantWaitTimeoutMs` при send
- `src/transfer/template-selection.ts` — match шаблона из таблицы, normalize outbound `*.md`
- `src/eai/session.ts` — transport, wait/stall logic
- `src/apply/content-extract.ts` — `isSubstantiveResult`, `isTemplatePickerMessage`, `isComparisonReport`, `isTemplateBodyDump`
- `src/apply/display-sanitize.ts` — sanitize bubble (не wait gate)

## Service feedback (`r7.event`) — ladcraft-r7_new

После auto-apply плагин делает quiet `POST /message` с fence ```r7.event``` (без optimistic bubble и без `prepareOutbound`).  
В UI user-строка скрыта (`isServiceFeedbackContent`). Подробнее: [03-apply-rules.md](03-apply-rules.md).
