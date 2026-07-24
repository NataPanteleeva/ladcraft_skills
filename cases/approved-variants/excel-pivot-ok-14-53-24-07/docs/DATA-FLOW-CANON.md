# Канон потоков данных: плагин ↔ Ladcraft

> **Единый источник истины** для `ladcraft-r7_new` + агентов LCA / Excel Pivot.  
> Версия плагина, к которой привязан текст: **≥ 0.6.50**.  
> Перед правкой transfer / apply / instruction — **сначала** правь этот файл, потом код.

Цель: не переписывать логику «с нуля» каждый раз. Здесь зафиксировано **что уходит, что приходит, когда уточнять, когда переписывать лист, какую фразу говорить клиенту**.

---

## 0. Два мира (не смешивать)

| Редактор | `contextFamily` | Primary в VFS | Обратный канал в редактор |
|----------|-----------------|---------------|---------------------------|
| **Word** | `document` | JSON `r7-snapshot/v1` | `r7.proposal` + кнопки / фраза «вставь» |
| **Cell** | `spreadsheet` | бинарный `.xlsx` | файл `/session/….xlsx` + кнопки **или** auto `sheet_replace` / `cell_format` |

Плагин выбирает family по `Asc.plugin.info.editorType` (`word` | `cell`).  
Профиль transfer по умолчанию: **`vfs`**. Disk-ref — только allowlist / override.

---

## 1. OUTBOUND (плагин → Ladcraft) на каждый `POST /message`

### 1.1. Общее

| Поле | Правило |
|------|---------|
| `content` | Текст задания пользователя (+ короткий supplement). **Не** тело документа. |
| `mentioned.files[]` | 1+ файлов контекста (snapshot / workbook / selection). |
| `files.editor` | **Не** для профиля `vfs`. |

Путь всегда брать из **текущего** `mentioned.files`, не из памяти прошлого чата (`sessionSeg` меняется).

### 1.2. Word (`document` + `vfs`)

```
content:
  <фраза пользователя>
  ---
  [Контекст R7: выделенный фрагмент]   ← только если есть выделение
  …

mentioned.files[0]:
  file_name: /session/r7/{sessionSeg}/r7-….json
  mime_type: application/json
  → JSON { schema: "r7-snapshot/v1", body: { text: "…" } }
```

На compare-turn (выбор шаблона `*.md`): supplement `session_file:` + **normalize только для реальных шаблонов** (имена `foo.md` / таблица «Шаблон»).  
**Запрещено** дописывать `.md` к пунктам аналитики / обычным вариантам ответа.

### 1.3. Cell (`spreadsheet` + `vfs`)

```
content:
  <фраза пользователя>
  ---
  [Контекст R7: workbook]
  workbook_path: /session/r7/{sessionSeg}/r7-….xlsx
  last_result_path: /session/….xlsx   ← ТОЛЬКО если userAsksToRefineLastResult(фраза)

mentioned.files[0]:
  file_name: тот же workbook_path
  mime_type: spreadsheet xlsx
```

| Когда слать `last_result_path` | Когда **не** слать |
|--------------------------------|--------------------|
| «доработай сводную», «по KPI», «из premium_kpi», «этот результат» | Новый вопрос по данным (оклад, город, фильтр, сводная «с нуля») |

**Канон источника для агента:** всегда сначала `workbook_path` (открытая книга). KPI/сводные в `/session/` — артефакты, не default.

Результат analytics (`*_filter.xlsx`, `top_*.xlsx`) **не** кладётся в `mentioned.files` и **не** дописывается в content как `last_result_path` вне refine. Он живёт в session VFS + строка `Файл:` в ответе + кнопки плагина.

Template-normalize (`….md`) для Cell **выключен** (`family === spreadsheet`).

### 1.4. Что пользователь **видит** в пузыре

- Текст выбора без суффикса `.md`, без служебных fence.
- Плагин чистит `stripChoiceArtifacts` на send и в UI.

---

## 2. INBOUND (Ladcraft → плагин)

### 2.1. Word / LCA

| Канал | Назначение | Когда плагин действует |
|-------|------------|------------------------|
| Markdown в чате | Человек читает | Всегда (санитизация fence) |
| ```r7.proposal``` | Машина | По фразе «вставь» / кнопке / intent-apply **без** нового хода к агенту |
| `tool_calls` (`r7_paste`, …) | Fallback auto-apply | После ответа, если proposal-пути нет |
| ```r7.event``` | Feedback после apply | Плагин шлёт скрыто; агент не re-apply |

**Инвариант Word:** без валидного proposal (или узкого markdown-fallback «Черновик:») плагин **не** пишет в документ.

### 2.2. Cell / Excel Pivot

Два **разных** исхода — не путать:

#### A) Новый файл-результат (аналитика)

| Агент делает | Плагин делает | Фраза клиенту |
|--------------|---------------|---------------|
| tool → `/session/foo.xlsx` | Ищет path в tool result / строке `Файл:` | 1–3 предложения + **обязательно** `Файл: /session/….xlsx` |
| — | Кнопки: **XLSX / Лист / Вставить / Заменить / CSV** | Можно коротко: «результат кнопками плагина» **только** вместе с `Файл:` |

Кнопки:

| Кнопка | Действие |
|--------|----------|
| **XLSX** | Скачать выбранный deliverable |
| **Лист** | Новый лист + матрица с A1 + viewport nudge |
| **Вставить** | Матрица от активной ячейки + nudge |
| **Заменить** | Очистить used range активного листа + матрица с A1 + nudge |
| **CSV** | Скачать csv |

Авто по фразе: «на новый лист» → **Лист**; «замени текущую таблицу» → **Заменить** (без агента).

Если агент записал `.xlsx`, но не написал `Файл:` (или ход оборвался платформенной ошибкой) — плагин **дописывает** `Файл:` из `targetPath` tool result, чтобы кнопки работали.

#### Outbound Cell — что плагин кладёт в ход (не перегружать)

| Слой | В каждом user turn? | Назначение |
|------|---------------------|------------|
| `workbook_path:` + `mentioned.files` = **открытая** книга | Да (upload обычно `skippedUpload` при том же hash) | Единственный default-источник |
| Результат `/session/*_filter.xlsx`, `top_*.xlsx` в `mentioned.files` | **Нет** | Файл только в session VFS + строка `Файл:` в ответе + кнопки |
| `last_result_path:` | **Только** refine-фразы (`userAsksToRefineLastResult`) | Доработка KPI/сводной прошлого файла |
| Бинарник прошлого результата в контекст модели | **Нет** | — |

Прошлый `Файл:` **не** становится default source следующего хода. История чата на стороне Ladcraft накапливается сама — агент не должен раздувать ответы и не вызывать tools «чтобы подложить файл в контекст».

#### B) Правка **открытой** книги (auto-apply)

| Tool | Тип в плагине | Когда |
|------|---------------|--------|
| `sheet_replace` | `sheet_replace_from_xlsx` | **Отключён в skill v13+** (`ok: false`). Перезапись листа — кнопка **Заменить** |
| `cell_format` | `cell_format` | Оформление (whitelist) |

Плагин применяет **сразу** после tool_calls (без кнопок Format/Replace).

| Фраза клиенту после B | Запрещено |
|-----------------------|-----------|
| 1–2 предложения: что сделано / чего нельзя | Упоминать XLSX / Лист / Вставить / Заменить |

---

## 2.3. Excel Pivot — матрица Intent (агент + навык)

Канон источника: §1.3. Плагин **не** классифицирует intent — только роутер в instruction/SKILL.

| Intent | Tools | Ответ агента | Плагин |
|--------|-------|--------------|--------|
| Сорт, поле ясно | `sort_rows` | только `userReply` | кнопки |
| Фильтр / «вынеси по городу» | (`inspect` если колонка неясна) → `filter_export` | `userReply` + `Файл:` | кнопки |
| KPI / «сколько / сумма» | `filter_export` и/или `top_n_summary` / `build_pivot_table` | кратко + `Файл:` | кнопки |
| Сводная | `inspect` → `build_pivot_table` | `Файл:` | кнопки |
| Шапка | `cell_format` | без `Файл:` / без кнопочных фраз | auto-apply |
| «Замени лист» / «на новый лист» | нет analytics | прошлый `Файл:` | local intent / кнопки |
| «Какую аналитику» | без tools | 2–4 варианта, стоп | — |
| Meta / вопрос про прошлый ответ («это по всем городам?») | **без** activate / tools | 1–3 предложения | — |
| Неясный scope («разбей по городам» без формата) | **без** tools | 1 короткий вопрос, стоп | — |

**Запрещено на любом intent:** host `bash` / `python` / `vfs_file_capabilities` / `readFile` artifacts; запись в `/session/r7/`; `targetPath` от модели; tools после `stop`/`userReply`.

Все analytics tools возвращают `ok` + `stop` + `userReply` + `doNot`. Follow-up «вынеси Москву» после ответа про Казань = **новый** вопрос к `workbook_path`, не refine.

---

## 3. Когда уточнять (агент стоп, без tools)

| Ситуация | Что спросить | Что **не** делать |
|----------|--------------|-------------------|
| Общий «сделай аналитику» без среза | 2–4 варианта (нумерованный список), дождаться выбора | Сразу строить 5 файлов |
| Неясный scope («разбей по городам» — 5 файлов? один лист?) | 1 короткий вопрос формата | Сразу `filter_export` / profile |
| Вопрос про прошлый ответ / `Файл:` («это по всем или по городу?») | 1–3 предложения по истории чата | activate toolkit / tools |
| `pick_working_source` → `needsUser: true` (несколько листов у открытой книги) | «На каком листе?» по `options.label` | Угадывать лист / брать KPI |
| Неясный фильтр («по региону») без значения | Уточнить город/значение | Фильтровать наугад |
| Выбор шаблона compare (Word) | Номер / имя `*.md` | Путать с пунктами Excel-аналитики |

Выбор пользователя уходит в API **как есть** (очищенный текст), **без** `.md`, если это не реальный шаблон compare.

### Виджеты clarification

- По умолчанию Excel-агент **не** шлёт виджеты действий листа (кнопки **XLSX / Лист / Вставить / Заменить / CSV** уже в action bar).
- Если runtime всё же отдал `kind=widget` / `widget_html` / `waiting_user` с формой — плагин **обязан** показать iframe или choice-list, а не оставить только спиннер.
- Платформенные confirm (move/rename файлов и т.п.) **не** рисуются как chat-widget; агент не должен их провоцировать (запрет bash/move результата в `/session/r7/`).

---

## 4. Когда переписывать открытый лист Cell

| Пользователь сказал | Агент | Плагин |
|---------------------|-------|--------|
| «отсортируй / отфильтруй / сводная» (новый результат) | tool → `/session/….xlsx` + `Файл:` | Кнопки; лист **не** трогать сам |
| «замени текущую таблицу / перепиши лист» + есть `Файл:` | достаточно `Файл:` | Плагин сам как **Заменить** (intent) |
| «сразу в книгу» через tool | после tool → `sheet_replace` (`mode: used`, `sourcePath` = target) | Auto-apply |
| «на новый лист» | достаточно `Файл:` | Плагин сам как **Лист** (intent) |
| «шапка жирным / заливка» | только `cell_format` whitelist | Auto-apply; **не** обещать границы/merge |

**Default после генерации файла:** не переписывать открытый лист, пока пользователь не попросил явно («Заменить» / фраза) или не нажал кнопку.

---

## 5. Матрица фраз после генерации (Cell)

| Исход хода | Строка `Файл:` | Кнопки в UI | Текст про кнопки в ответе агента |
|------------|----------------|-------------|-----------------------------------|
| Новый `/session/….xlsx` | **Обязательно** | Да | Разрешено (кратко) |
| Только `sheet_replace` / `cell_format` | Нет | Нет (уже применено) | **Запрещено** |
| Уточняющий вопрос | Нет | Нет | Не писать про файлы |
| Ошибка tool | Нет | Нет | Честный отказ, стоп |

Word: фразы про «вставь» — только если есть proposal / Черновик; иначе плагин форвардит агенту «повтори с r7.proposal».

---

## 6. Диаграмма (логические блоки)

```text
[User phrase]
     │
     ├─ Word intent «вставь» + proposal? ──► Asc apply ──► STOP (нет агента)
     │
     ├─ Cell intent «на новый лист» + есть Файл:? ──► Лист ──► STOP
     │
     ├─ Cell intent «замени таблицу» + есть Файл:? ──► Заменить ──► STOP
     │
     └─ POST /message
            │
            ├─ Word: upload snapshot JSON + mentioned
            └─ Cell: upload workbook xlsx + workbook_path
                       (+ last_result_path только refine)
            │
            ▼
        [Agent / skills]
            │
            ├─ needs clarify? ──► вопрос ──► STOP
            ├─ analytics tools ──► /session/*.xlsx + «Файл:»
            │                         │
            │                         └─ plugin buttons XLSX|Лист|Вставить|Заменить|CSV
            ├─ sheet_replace / cell_format ──► plugin auto Asc
            └─ Word r7.proposal ──► wait user «вставь» / button
```

---

## 7. Запрещённые анти-паттерны (уже ломали прод)

1. Дописывать `.md` к любому нумерованному пункту (путаница compare ↔ Excel).  
2. Всегда слать `last_result_path` → агент читает KPI вместо общей книги.  
3. После `cell_format` писать «нажмите Лист / Вставить / Заменить».  
4. Класть результат аналитики в `/session/r7/…` (путь открытой книги).  
5. Ждать полного platform-parse Word JSON минутами, блокируя чат.  
6. Считать кнопку `Format` каноном Cell — **снята**; оформление — `cell_format`. Перезапись листа — кнопка/фраза **Заменить** или opt-in `sheet_replace`.
7. Оставлять прошлый run в `waiting_approval` / `queued` при новом чате — очередь агента блокируется. Новый вход: `abort` активных runs (история на сайте сохраняется), затем `createSession`.
8. После analytics `stop`/`userReply` вызывать host-tools (`bash`/`python`/`vfs_*`) — платформа рвёт ход («Не удалось продолжить…»), follow-up зависает в очереди.
9. Не abort-ить перед follow-up send: второе сообщение уходит в history, но assistant не стартует, пока чужой/текущий run в `waiting_approval`/`queued`.

---

## 7.1. Multi-turn (обязательный контракт)

Как LCA: **один Intent → один activate → чистый стоп → следующий user turn**.

| Шаг | Кто | Правило |
|-----|-----|---------|
| 1 | Plugin | Перед `POST /message`: после analytics `Файл:` — `finishPreviousAgentSessions` (вся очередь агента) + пауза; иначе abort blocking/`queued` и leftover текущей сессии. Если за ~16 с нет assistant при пустой activity — orphan-retry (один повторный POST). History **не** удалять. |
| 2 | Agent | Новый user text = новый Intent. Доуточнения и следующие задачи — норма. Предыдущий `Файл:` не блокирует. |
| 3 | Agent | Один `skills activate` на ход (нужный навык по router). Не смешивать навыки в одном ходе. |
| 4 | Skill | Analytics → `stop`+`userReply` → ответ = **только** `userReply`. Ноль tools после. |
| 5 | Plugin | Ход готов по `userReply`/`Файл:` (не ждать `status=completed`). Кнопки XLSX/Лист… |
| 6 | Plugin | «на новый лист» / «замени таблицу» — local intent, без агента. |

Не рвать чужие non-blocking mid-flight сессии. Текущий чат: новый user text прерывает leftover run (иначе follow-up orphan).

---

## 8. Связанные файлы

| Тема | Путь |
|------|------|
| Transfer Word/VFS | `docs/01-transfer-rules.md` |
| Chat / SSE | `docs/02-chat-rules.md` |
| Apply / proposal | `docs/03-apply-rules.md`, `docs/04-skill-output-contract.md` |
| Cell детали / viewport | `docs/TABLE-AGENTS-PLUGIN.md` |
| Контракт агента Word | `docs/AGENT-PLUGIN-CONTRACT.md` |
| Excel агент | `cases/excel_pivot_report/docs/PLUGIN-R7.md`, `excel_pivot_agent/instruction.md` |
| LCA | `cases/LCA/agent/instruction` |
| Код outbound | `src/transfer/index.ts`, `message-payload.ts` |
| Код inbound Cell | `src/apply/task-runner.ts`, `action-buttons-spreadsheet.ts`, `agent-deliverables.ts` |

---

## 9. Чеклист перед изменением логики

- [ ] Правка вписывается в §1–5 этого файла? Если нет — **сначала** обновить канон.  
- [ ] Word и Cell не смешаны в одном правиле?  
- [ ] Есть явный ответ: «уточнять / файл+кнопки / auto-apply»?  
- [ ] Фраза клиенту согласована с §5?  
- [ ] Smoke: один ход Word proposal; один ход Cell `Файл:`; follow-up sort в той же сессии; один ход `sheet_replace` без кнопочной фразы.
