# Контракт агента для плагина ladcraft-r7_new

Документ для сотрудников и AI при **создании / настройке агентов** под плагин R7 Office `ladcraft-r7_new`.

Плагин: `cases/plugin/ladcraft-r7_new/`.  
Эталон агента: `cases/LCA/` (лингвистическая проверка).

---

## 1. Зачем этот контракт

Плагин и агент — **два разных контура**:

| Кто | Роль |
|-----|------|
| **Плагин** | Снимает документ → кладёт в Ladcraft; после согласия пользователя **сам** пишет в Word/Cell |
| **Агент** | Читает контекст; отвечает человеку; кладёт машиночитаемый **proposal**; **не** правит документ напрямую на шаге черновика |

Если агент ждёт HTML в message, пишет только markdown без proposal или вызывает write-tools на каждое «вставь» — интеграция ломается.

---

## 2. Как агент **получает** данные (плагин → Ladcraft)

### 2.1. Default: session VFS (для новых агентов)

По умолчанию плагин **загружает snapshot** в session VFS. В каждом сообщении пользователя:

| Поле | Что это |
|------|---------|
| `content` | Текст задания пользователя (+ иногда supplement) |
| `mentioned.files[0].file_name` | **Path к snapshot** — обычно `/session/r7/{sessionSeg}/r7-word_….json` |
| `mentioned.files[0].file_id` | Id файла в VFS Ladcraft |
| `mentioned.files[0].mime_type` | `application/json` |

**`sessionSeg`** — короткий кусок `session_id` чата. Path **меняется между сессиями**. Всегда бери path из **текущего** `mentioned.files`, не из памяти / прошлого чата.

### 2.2. Как читать документ

```bash
bash head -c 200000 "{session_file}"
```

где `session_file` = дословно `mentioned.files[0].file_name`.

Успех: в stdout есть `"schema":"r7-snapshot/v1"` и непустой **`body.text`**.

| Поле snapshot | Смысл |
|---------------|--------|
| `schema` | `r7-snapshot/v1` |
| `body.text` | **Текст документа для модели** (plain text, не HTML) |
| `editor` / `type` | `word` или `cell` |

**Запрещено:**

- считать источником истины `/workspace/r7/…`;
- `find` / `ls` / перебор JSON «наугад» по snapshot;
- выдумывать текст документа без успешного READ;
- ждать HTML-документа в `content` сообщения.

### 2.3. Выделение в редакторе

Если пользователь что-то выделил, в `content` может быть блок:

```text
[Контекст R7: выделенный фрагмент]
…plain text…
```

Плюс иногда отдельный selection-файл в `mentioned.files`. Для переписи / комментария опирайся на этот фрагмент.

### 2.4. Opt-out: disk-ref (только если явно настроено)

Некоторые агенты работают **без** VFS: в `mentioned.files` приходит `file_id` вида `r7-disk:{id}`. Тогда документ качает **навык** с Р7-Диска (`R7_DISK_*`), не bash по `/session/r7/`.

Для **новых агентов под ladcraft-r7_new** считайте каноном **VFS**, если отдельно не сказали «disk-ref».

---

## 3. Как агент **отдаёт** данные (Ladcraft → плагин)

### 3.1. Dual payload (обязательно для вставок)

Каждый ответ, после которого пользователь может нажать «вставь» / «исправь» / «да»:

1. **Человеческий markdown** в чате (черновик, таблица «Было → Стало», саммари).
2. Скрытый fence **`r7.proposal`** с полным машиночитаемым payload.

Плагин на одобрении читает **proposal**, а не «всё окно» чата.

**Инвариант:** без валидного `r7.proposal` плагин **не** вставит текст в документ.

### 3.2. Виды proposal

| `kind` | Когда | Что делает плагин после согласия |
|--------|--------|----------------------------------|
| `blob` | Черновик, саммари, новый текст | `paste_text` / `replace_selection` |
| `findings` | Таблица замечаний (проверка) | `search_replace` по пунктам |
| `cell_map` | Значения ячеек | `cell_paste` |
| `comment` | Комментарий рецензента | `add_comment` (нужно выделение) |

### 3.3. Примеры

**Вставка / саммари (`blob`):**

````markdown
**Черновик:**
Полный текст абзаца для Word.

```r7.proposal
{"schema":"r7.proposal/v1","kind":"blob","op":"paste_text","text":"Полный текст абзаца для Word.","defaultPosition":"cursor"}
```
````

- В `text` — **тот же полный** текст, что под «Черновик:» (не урезать).
- Для заголовков в Word пиши markdown `# Заголовок`, не только `**жирный**`.
- `op:"paste_text"` — markdown → HTML в плагине. Не клади markdown в `op:"paste"` (иначе `**`/`|` уйдут буквально).

**Замена выделения:**

```r7.proposal
{"schema":"r7.proposal/v1","kind":"blob","op":"replace_selection","preferReplaceSelection":true,"text":"…только новый текст…"}
```

**Проверка (`findings`):**

````markdown
| № | Было | Стало |
|---|------|-------|
| 1 | ошипка | ошибка |

Что дальше?
— Напишите **исправь все** — применю все замены
— или **исправь 1, 3**

```r7.proposal
{"schema":"r7.proposal/v1","kind":"findings","revision":1,"items":[{"id":1,"op":"search_replace","search":"ошипка","replace":"ошибка","matchCase":false}]}
```
````

`search` делай достаточно уникальным (фрагмент с контекстом): SearchAndReplace глобален по документу.

### 3.4. Confirm-before-insert

Даже если пользователь сказал «сгенерируй и вставь»:

1. Сначала черновик + proposal в чате.
2. Документ **не** менять write-tools.
3. Вставку сделает **плагин** по фразе пользователя («вставь», «исправь все», …).

Фразы «вставь» / «да» / «исправь…» **обычно не приходят** агенту как новый ход — плагин обрабатывает их локально. **Не** вызывай paste/search_replace «на всякий случай».

Если одобрение всё же попало в чат: краткий ack, **без** tools.

### 3.5. Fallback (редко)

| Ситуация | Действие |
|----------|----------|
| «замени X на Y» без proposal | write-tool навыка (`r7_search_replace` и т.п.) |
| proposal битый / отсутствует, согласие уже есть | tool навыка или отказ с просьбой повторить с `r7.proposal` |
| Fence `r7.task` как основной канал правок | **не использовать** для новых агентов под этот плагин |

После успешного локального apply плагин может тихо прислать `r7.event` (`apply_result`). Не повторяй apply; сырой JSON пользователю не показывай.

---

## 4. Workspace (БЗ) vs session (документ)

| Что | Где | Между чатами |
|-----|-----|--------------|
| Правила, стили, methodology, prompts | `/workspace/…` | **Общие** |
| Snapshot открытого Word/Cell | `/session/r7/{sessionSeg}/…` | **Свой на сессию** |

Не путать: одинаковые файлы в `/workspace` во всех чатах — норма. Snapshot — всегда из текущего `mentioned.files`.

---

## 5. Чеклист создания нового агента

1. **Плагин:** пользователь ставит `ladcraft-r7_new` (не старый btn_stream, если нужен proposal-контракт).
2. **Transfer:** по умолчанию VFS — **не** добавлять агента в disk-ref allowlist, если нужен snapshot.
3. **Instruction:** источник документа = `mentioned.files[0].file_name` → READ → `body.text`.
4. **Навыки:** на шаге черновика — **без** write-tools; dual payload `markdown + r7.proposal`.
5. **Согласование:** confirm-before-insert; плагин применяет правки.
6. **Smoke:** открыть чат → Network `vfs/upload` → агент читает snapshot → ответ с `r7.proposal` → «вставь» меняет Word **без** нового длинного ответа модели.

### Если нужен disk-ref (исключение)

Сообщить команде плагина: добавить `agent_id` в `DISK_REF_AGENT_IDS` или задать  
`localStorage ladcraft_r7_transfer_profile:{agentId} = "disk-ref"`.  
Instruction и навыки тогда — под `r7-disk:{id}` и `R7_DISK_*`, не под `/session/r7/`.

---

## 6. Частые ошибки

| Ошибка | Правильно |
|--------|-----------|
| Ждать HTML документа в message | Читать `body.text` из JSON snapshot |
| Вставлять через `r7.task` / paste-tool сразу | Сначала proposal; плагин после «вставь» |
| Proposal с урезанным `text` | Полный тот же текст, что в черновике |
| Запомнить path snapshot навсегда | Каждый раз из `mentioned.files` |
| Disk-навыки + VFS в плагине | Согласовать один профиль |

---

## 7. Ссылки в репозитории

| Тема | Путь |
|------|------|
| Плагин | `cases/plugin/ladcraft-r7_new/` |
| Transfer (VFS default) | `cases/plugin/ladcraft-r7_new/docs/01-transfer-rules.md` |
| Proposal / apply | `cases/plugin/ladcraft-r7_new/docs/04-skill-output-contract.md` |
| Apply rules | `cases/plugin/ladcraft-r7_new/docs/03-apply-rules.md` |
| Эталон instruction | `cases/LCA/agent/instruction` |
| Эталон навыков | `cases/LCA/skills/` |

---

*Канон для агентов под `ladcraft-r7_new`. При расхождении с prod — сверять Network (`vfs/upload`, `mentioned.files`) и наличие fence `r7.proposal` в history.*
