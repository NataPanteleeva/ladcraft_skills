# Контракт данных: плагин ladcraft-r7 → агент Ladcraft

Источник: интеграция кейса `doc_compare` + спецификация `ladcraft-r7` (`src/transfer/`).
Используй этот документ при настройке **любого** агента, который получает открытый документ из R7.

---

## Общая схема

```text
R7 (Word/Cell) → плагин ladcraft-r7 → VFS session → агент Ladcraft
                      │
                      ├─ POST /v1/agent/vfs/upload  (snapshot JSON)
                      └─ POST /v1/agent/session/{id}/message  (текст + mentioned.files)
```

Плагин **не кладёт** полный текст документа в `content` сообщения. Текст — только в snapshot в VFS.

---

## Документ B (открытый в R7)

### Upload в VFS

| Параметр | Значение |
|----------|----------|
| API | `POST /v1/agent/vfs/upload` |
| `scope` | `session` |
| `session_id` | id агент-сессии (чат) |
| `path` (в multipart) | `/r7/r7-{sanitizedDocKey}.json` |
| `sync` | **`true`** — дождаться ответа до отправки message (рекомендуется) |
| Bash-path | `/session/r7/r7-{sanitizedDocKey}.json` |
| UI path | `~/session/r7/r7-….json` |

### Имя файла и docKey

```
docKey = {editor}:{url или title}
пример: word:7b6db4c8d218664ebb84

sanitizedDocKey = docKey с заменой спецсимволов на _, длина до 80 символов
имя файла: r7-{sanitizedDocKey}.json
пример: r7-word_7b6db4c8d218664ebb84.json
```

### Заголовок чата (подсказка для агента)

Формат title сессии от плагина:

```text
R7: word:7b6db4c8d218664ebb84::agent:mwCvjRF
     └─ doc_key ─────────────┘
```

Из title извлекай `doc_key` (`word:7b6db4c8d218664ebb84`) для детерминированного пути к snapshot.

---

## Сообщения пользователя (`POST /v1/agent/session/{id}/message`)

### Тело запроса

```json
{
  "content": "текст задания пользователя",
  "mentioned": {
    "files": [{
      "file_id": "<opaque или UUID>",
      "file_name": "/session/r7/r7-word_57cd20e7e4c9caf56886.json",
      "mime_type": "application/json"
    }]
  }
}
```

| Поле | Назначение |
|------|------------|
| `content` | Задание пользователя; **не** полный текст документа |
| `mentioned.files[].file_name` | **Bash-path** к snapshot — передаётся в `read_r7_snapshot_text` |
| `mentioned.files[].file_id` | Для API Ladcraft и smoke `download` в плагине |

### Когда есть `mentioned.files`

| Сообщение | `mentioned.files` | Примечание |
|-----------|-------------------|------------|
| 1-е (doc-compare) | **да** | Плагин кладёт snapshot до send; навык не читает B до выбора шаблона |
| каждое | **да** | Явная ссылка на документ B |

`files.editor` для doc-compare **не** отправляется.

---

## Формат файла B (`r7-snapshot/v1`)

```json
{
  "schema": "r7-snapshot/v1",
  "editor": "word",
  "docKey": "word:…",
  "exportedAt": "ISO-8601",
  "contentHash": "sha256:…",
  "body": {
    "text": "plain text для сравнения",
    "paragraphs": ["…"]
  },
  "type": "word",
  "content": ["…legacy paragraphs…"]
}
```

Для сравнения/анализа: **`body.text`** (достаточно прочитать начало файла).

---

## Как агенту читать данные

### Документ B (session) — compare-r7 (prod)

| Способ | Команда | Когда |
|--------|---------|--------|
| **Основной** | host `bash` → `head -c 200000 "<session_file>"` | COMPARE; из JSON извлечь `body.text` |
| Skill VFS | `read_r7_snapshot_text` / `load_compare_pair` | **Не использовать** — зависания ~600 с |
| python pipe | `cat \| python3` на session | **Запрещён** sandbox |

Канон: [`approved-r7-document-compare.md`](../../compare-r7/docs/approved-r7-document-compare.md).

### Документ B (session) — legacy doc_compare

| Способ | Команда / tool | Когда |
|--------|----------------|--------|
| Skill | **`read_r7_snapshot_text`** | Legacy `doc_compare_toolkit` |
| Retry | **`resolve_r7_document`** / **`startup_compare`** | Legacy старт |

### Шаблон A (workspace)

| Способ | Команда | Когда |
|--------|---------|--------|
| **Список на START** | `bash` → `ls -la /workspace/Templates/` | compare-r7 START |
| **Чтение COMPARE** | `head -c 150000 "/workspace/Templates/{имя}.md"` | compare-r7 |
| Альтернатива A | `cat "…" \| head -c 150000` | пробелы в имени |

**Не использовать на START:** skill VFS `listDir`, `startup_compare`, `list_templates` для списка шаблонов — в R7 ненадёжно.

---

## Гонка upload ↔ первое сообщение

**Частая проблема:** агент стартует раньше, чем upload завершился (~1 MB JSON).

Симптомы:
- `bash ls /session/r7/` → `DIR_NOT_FOUND` на 1-м ходе;
- через несколько секунд файл уже есть в VFS API (`~/session/r7/r7-….json`).

### Обязательно в навыке/агенте

1. `resolve_r7_document` с **retry** (по умолчанию 3×, 2000 ms).
2. Детерминированный path из `doc_key` / title чата.
3. Не просить повторную загрузку, пока retry не исчерпан.

### Рекомендуется в плагине (ladcraft-r7, `src/transfer/`)

```text
create session
→ upload snapshot (sync:true)
→ await HTTP 200
→ затем POST message (желательно с mentioned.files уже на 1-м сообщении)
```

Менять `scope=session` или путь `/r7/r7-….json` **не нужно**.

---

## Шаблон настройки нового агента

### Instruction (агент)

1. **Список шаблонов (START):** bash `ls -la /workspace/Templates/` + таблица в чате — канон [`cases/compare-r7/docs/approved-r7-document-compare.md`](../../compare-r7/docs/approved-r7-document-compare.md).
2. После выбора шаблона: **`read_r7_snapshot_text`** / **`prepare_compare`** по `session_file` (не bash на `/session/r7/`).
3. **Не** повторять список шаблонов на COMPARE.
4. Не показывать chain-of-thought; не упоминать демо/заготовки (если сценарий это запрещает).
5. Вставка в Word: не писать в JSON snapshot — `r7-export` / задачи плагина.

### Skill (навык)

| Tool | Назначение |
|------|------------|
| `read_r7_snapshot_text` | Чтение `body.text` из snapshot (skill VFS `source: original`) |
| `resolve_r7_document` | Поиск snapshot + retry; `found` только при готовом `body.text` |
| `list_session_files` | Список json в `/session/r7/` с `ready` |
| `list_templates` | Шаблоны в workspace |

`general.lib`: `vfsSnapshotReady`, `readR7SnapshotOriginal`, `sanitizeR7DocKey`, `scanR7SessionFiles`, `sleepMs`.

Референс-реализация: `cases/doc_compare/doc_compare_toolkit/`.

### Workspace агента

```
/workspace/Templates/   ← шаблоны (A)
/workspace/temp.md        ← отчёт (если сценарий с предзаготовленным отчётом)
```

---

## Проверка через API (headless)

```bash
# Список файлов сессии
node .cursor/skills/ladcraft-agent-drive/scripts/lc_agent_drive.js \
  vfs-list session --session <sessionId> --path r7 --hierarchical
```

Ожидаемый файл: `~/session/r7/r7-word_{docId}.json`.

---

## Ссылки в репозитории

| Путь | Содержание |
|------|------------|
| `cases/compare-r7/docs/approved-r7-document-compare.md` | **Одобренный** START: bash-список шаблонов + COMPARE без повтора |
| `cases/doc_compare/doc_compare_toolkit/` | Навык с `resolve_r7_document` |
| `cases/doc_compare/doc_compare_agent/instruction.md` | Инструкция агента сравнения |
| `cases/compare-r7/` | R7 compare-r7: агент + `r7-compare-toolkit` |
| `.cursor/rules/ladcraft-r7-plugin-transfer.mdc` | Краткое правило для Cursor-агента |

---

*Обновлено: 2026-06-28 — список шаблонов на START: bash `ls` (канон compare-r7); чтение B через skill.*
