# Справка: что плагин отправляет в VFS и как это увидеть в DevTools

**Аудитория:** руководство, аналитики, разработчики интеграции R7 + Ladcraft.

**Дата:** июль 2026.

**Краткий ответ:** в VFS плагин кладёт **не HTML**, а **JSON-файл** (`application/json`) с **обычным текстом** документа в поле `body.text`. HTML используется только при **обратной вставке** ответа агента в Word (`PasteHtml`), а не при upload в VFS.

---

## 1. Два режима передачи документа в Ladcraft

Плагин `ladcraft-r7_new` (и родственные сборки) выбирает профиль так:

| Профиль | Upload в VFS | Что уходит в сообщении агенту |
|---------|--------------|------------------------------|
| **VFS snapshot** (**default**) | **Да** | `file_id` VFS + путь `/session/r7/….json` в `mentioned.files` |
| **disk-ref** (явная опция) | **Нет** | Ссылка `r7-disk:{document_id}` + supplement в `content` |

Если в Network **нет** запроса `vfs/upload` — агент на **disk-ref** (allowlist / override), тело документа плагин не загружает.

disk-ref включается только явно: `DISK_REF_AGENT_IDS`, title `r7-compare-docs`, или  
`localStorage.setItem("ladcraft_r7_transfer_profile:<agentId>", "disk-ref")`.

---

## 2. Что именно уходит в VFS (профиль VFS snapshot)

### 2.1. Формат файла

- Тип MIME при upload: **`application/json`**.
- Имя файла: `r7-{ключ_документа}.json` (например `r7-word_….json`).
- Путь в session VFS: `/r7/r7-….json`.
- API: `POST https://api.ladcraft.ru/v1/agent/vfs/upload` с полями:
  - `scope` = `session`
  - `session_id` = id чата Ladcraft
  - `sync` = `true` (дождаться готовности файла)
  - `file` = blob JSON

### 2.2. Схема JSON (`r7-snapshot/v1`)

Основные поля:

| Поле | Смысл |
|------|--------|
| `schema` | Всегда `r7-snapshot/v1` |
| `editor` | `word` или `cell` |
| `docKey` | Идентификатор документа в плагине |
| `exportedAt` | Время снимка (ISO) |
| `contentHash` | Хеш содержимого для дедупликации |
| `type` | `word` или `cell` |
| `body.text` | **Главное для агента** — plain text документа |
| `body.paragraphs` | Для Word — массив параграфов (текст) |
| `content` | Дублирование параграфов Word |
| `body.blocks` / `blocks` | Для Cell — структура ячеек |

**Пример (Word, упрощённо):**

```json
{
  "schema": "r7-snapshot/v1",
  "editor": "word",
  "type": "word",
  "body": {
    "text": "Первый параграф\n\nВторой параграф",
    "paragraphs": ["Первый параграф", "Второй параграф"]
  },
  "content": ["Первый параграф", "Второй параграф"]
}
```

### 2.3. Откуда берётся текст в snapshot (плагин, не HTML)

Плагин читает документ через **API редактора R7**:

- **Word:** `GetDocument().GetContent()` → для каждого блока `GetText()`; для таблиц — попытка `ToMarkdown()` (не HTML).
- **Cell:** значения ячеек листа, склейка в текстовые строки (TSV-подобно).

Итог в `body.text` — **plain text** (с переносами строк), **не** разметка Word и **не** HTML.

### 2.4. Выделение в редакторе (отдельный JSON)

При непустом выделении дополнительно может загружаться файл **`r7-selection/v1`**:

| Поле | Смысл |
|------|--------|
| `schema` | `r7-selection/v1` |
| `text` | Plain text выделения |
| `empty` | `false` |

Плюс в `content` сообщения может быть supplement: `[Контекст R7: выделенный фрагмент]`.

---

## 3. Режим disk-ref: VFS не используется для тела документа

Плагин передаёт только **идентификатор** файла на Р7-Диске:

- `mentioned.files[0].file_id` = `r7-disk:114`
- `mentioned.files[0].file_name` = имя файла (например `Договор.docx`)
- В `content` — блок `[Контекст R7: диск]` с `document_id` и `file_name`

**Текст документа** агент получает позже, когда **навык** скачивает файл с Р7-Диска по API (`Download?id=…`) и извлекает plain text из `.md` или `.docx` (парсинг XML внутри docx на стороне навыка).

---

## 4. Где HTML в процессе

| Этап | HTML? |
|------|-------|
| Upload в VFS | **Нет** — только JSON + `body.text` |
| Сообщение агенту (disk-ref) | **Нет** — id и supplements |
| Ответ агента в чат | Markdown для человека |
| Вставка в Word (Apply) | **Да** — markdown/HTML → `PasteHtml` |

HTML — канал **«агент → документ»**, не **«документ → Ladcraft VFS»**.

---

## 5. Как показать в инструментах разработчика (DevTools)

### 5.1. Открыть DevTools на панели плагина

1. Откройте R7 Office (Word/Cell) с установленным плагином Ladcraft.
2. Откройте боковую панель Ladcraft.
3. Откройте инструменты разработчика на iframe плагина (Inspect / «Просмотреть код» — если доступно в вашей сборке R7; в веб-R7 — F12).

### 5.2. Вкладка Network — upload в VFS

**Условие:** профиль VFS (default для `ladcraft-r7_new`, в т.ч. LCA). Отправьте сообщение в чат или нажмите «Синхр. документ».

1. Вкладка **Network**.
2. Найдите запрос **`upload`** (или фильтр `vfs/upload`).
3. **Headers:**
   - Request URL: `…/v1/agent/vfs/upload`
   - Method: `POST`
   - Status: `200` при успехе
4. Вкладка **Payload** (Form Data):
   - `scope` = `session`
   - `session_id` = …
   - `sync` = `true`
   - `path` = `/r7/r7-….json`
   - `file` = binary (JSON)

### 5.3. Вкладка Network — структура JSON (удобнее через download)

1. Найдите запрос **`download?format=original`** (или `GET …/vfs/files/{file_id}/download`).
2. Вкладка **Preview** или **Response**.
3. Убедитесь: `schema: "r7-snapshot/v1"`, непустой **`body.text`**.

Это наглядный ответ на вопрос «текст или HTML» — в ответе **текст в JSON**, не HTML.

### 5.4. Сообщение агенту (disk-ref)

1. Запрос **`message`** или **`POST`** к API агента.
2. В Payload JSON смотрите `mentioned.files`:
   - `file_id`: `r7-disk:12345`
   - **нет** upload — запроса `vfs/upload` не будет.

### 5.5. Local Storage (дополнительно)

| Ключ | Назначение |
|------|------------|
| `ladcraft_r7_doc_context:{userId}:{docKey}` | `file_id` snapshot в VFS |
| `ladcraft_r7_session:…` | `session_id` чата |

---

## 6. Как навык читает документ после передачи

### 6.1. Путь VFS (snapshot)

- Агент/навык читает файл по пути из `mentioned.files[0].file_name` (например `/session/r7/…/r7-word_….json`).
- Инструменты: `read_r7_snapshot_text`, `bash head` по session path.
- В контекст LLM попадает поле **`text`** из tool result (срез `body.text`).

### 6.2. Путь disk-ref

- Навык `r7_fetch_disk_document` скачивает `.docx` / `.md` с Р7-Диска.
- Результат tool: `{ ok: true, text: "…plain text…" }`.
- В message плагин **не** кладёт тело docx.

### 6.3. Форматирование (таблицы, заголовки)

| Источник | Таблицы / заголовки в контексте агента |
|----------|----------------------------------------|
| VFS snapshot из Word | В основном plain text; таблицы — частично через ToMarkdown при снятии снимка |
| disk-ref `.md` | Markdown (таблицы `|…|`, заголовки `#`) |
| disk-ref `.docx` | Plain text из XML docx (структура таблиц теряется) |
| Вставка обратно в Word | Markdown отчёта → MD→HTML → PasteHtml (таблицы и заголовки восстанавливаются при вставке) |

---

## 7. Замена выделенного текста (кратко, для полноты картины)

Это **не VFS**, а блок Apply плагина:

1. **Вход:** выделение уходит в supplement и/или `r7-selection/v1` (plain text).
2. **Выход:** агент отдаёт `r7.proposal` или (legacy) `r7.task` с `replace_selection` / `search_replace`.
3. Плагин применяет к **открытому** документу через Asc API (`PasteHtml`, `SearchAndReplace`), данные берутся из ответа агента, **не** перечитываются из VFS.

Для LCA основной канал — **`r7.proposal`** + фраза пользователя «вставь» / «исправь» (локальный apply без нового хода к агенту).

---

## 8. Шпаргалка для ответа коллеге (одним абзацем)

Плагин в VFS отправляет **JSON snapshot** (`r7-snapshot/v1`) с **plain text** в `body.text`, **не HTML**. По умолчанию для многих агентов используется **disk-ref** — тогда VFS upload **нет**, только `r7-disk:{id}`. Показать в DevTools: Network → `upload` (Payload) и `download` (Preview → `body.text`); для disk-ref — POST `message` с `r7-disk:…` без upload.

---

## 9. Ссылки в репозитории

| Тема | Путь |
|------|------|
| Правила transfer | `cases/plugin/ladcraft-r7_btn_stream/docs/01-transfer-rules.md` |
| Snapshot schema | `cases/plugin/ladcraft-r7_btn_stream/src/transfer/snapshot.ts` |
| VFS upload | `cases/plugin/ladcraft-r7_btn_stream/src/eai/vfs.ts` |
| disk-ref | `cases/plugin/ladcraft-r7_btn_stream/src/transfer/disk-ref.ts` |
| Чтение с диска (навык) | `cases/r7-compare-docs/r7-compare-disk/scripts/_r7_disk_compare_common.js` |

---

*Внутренний документ. При расхождении с prod проверяйте фактический Network trace и профиль агента (VFS vs disk-ref).*
