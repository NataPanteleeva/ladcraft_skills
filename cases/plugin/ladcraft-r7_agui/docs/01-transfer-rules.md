# Блок 1: Передача данных (R7 → Ladcraft payload)

> **Default:** **session VFS** — Word: `r7-snapshot/v1` JSON; Cell: `.xlsx` (см. [TABLE-AGENTS-PLUGIN.md](TABLE-AGENTS-PLUGIN.md)).  
> **Opt-in:** **disk-ref** — без VFS; `r7-disk:{id}` + supplement. `DISK_REF_AGENT_IDS`, title `r7-compare-docs`, или localStorage.

> **Схема snapshot (Word):** `r7-snapshot/v1` в [`snapshot.ts`](../src/transfer/snapshot.ts) и [AGENT-PLUGIN-CONTRACT.md](AGENT-PLUGIN-CONTRACT.md).

## Ответственность

- Снять снимок документа / выделения из R7
- Upload в **session VFS** (`scope=session`, `session_id`)
- Собрать `OutboundTransfer` для `POST /message`
- Smoke: `GET …/vfs/files/{file_id}/download`

## Не входит

- UI чата, polling, виджеты (блок 2)
- Парсинг ответа, `r7.task`, вставка (блок 3)

## Обязательные правила

- [ ] Один канонический `file_id` на документ в **текущей** session VFS (`vfsSessionId` в registry)
- [ ] Upload: `scope=session`, `session_id`, path **`/r7/{sessionSeg}/{fileName}`**, **`sync:true`**
  - `sessionSeg` = первые 8–12 символов `session_id` (см. `sessionPathSegment`)
  - Имя файла: `r7-{sanitizedDocKey}.json` / `r7-selection_{docKey}.json`
- [ ] Перед POST upload: best-effort `DELETE /v1/agent/vfs/folders` на целевой path; при «путь занят» — delete + один retry (`uploadDocumentContextWithRecovery`)
- [ ] Перед send: upload → `parsing_status: complete` → `verifyFileReadable(file_id)` (schema + `body.text` ≥ 100 символов)
- [ ] **Открытие чата:** `createSession` → `ensureDocumentContext` (`forceReupload`) → только потом `chatReady` и ввод
- [ ] Каждый `POST …/message` (включая 1-й): `mentioned.files[]` с `file_id`, `file_name` = **`/session/r7/{sessionSeg}/…`**, `mime_type: application/json`
- [ ] `files.editor` — профиль `editor-mount`; для VFS-профиля **не отправлять**
- [ ] `content` — текст задания пользователя; **не** вкладывать полный документ в `content`
- [ ] Допустим supplement выделения в `content` (блок `[Контекст R7: выделенный фрагмент]`)
- [ ] Supplement пути snapshot (Word, template-turn): `session_file: /session/r7/{sessionSeg}/…`
- [ ] Cell (spreadsheet): `workbook_path:` + `mentioned.files` с `.xlsx`
- [ ] Snapshot: `schema: r7-snapshot/v1`, обязателен `body.text`
- [ ] Точка изменений: `src/transfer/` (`prepareOutbound` — единая entry point)

## Workspace vs session (UI «Файлы агента»)

| Путь | Scope | Между сессиями чата |
|------|-------|---------------------|
| `/workspace/methodology`, `rules`, `style`, `prompts` | workspace агента | **Общие** (БЗ) — так и должно быть |
| `/session/r7/{sessionSeg}/r7-word_….json` | session | **Свой** snapshot на чат; path уникален по sessionSeg |
| старые `r7-word_*` без segment | legacy | Best-effort delete при close / reupload |

Не путать: одинаковые правила в разных чатах — норма; одинаковые `r7-word_*` без segment — баг коллизии (исправлено sessionSeg).

## Отклонено (схема 1)

- Блок `[Контекст R7: документ]` в `content` — **не использовать** (полный текст snapshot)
- Блок `[Контекст R7: snapshot path]` — **только** `session_file:` на compare-turn; не дублировать тело JSON
- Custom tool `doc_compare_read` для документа B — **не использовать**

## Контракты

```typescript
// src/transfer/types.ts
interface OutboundTransfer {
  content: string;
  fileRefs: FileRef[];
  attachEditor: boolean;
  primaryFileId: string;
  primaryFileName: string;
}
```

HTTP body (блок 2 передаёт как есть):

```json
{
  "content": "текст задания",
  "mentioned": { "files": [{ "file_id", "file_name": "/session/r7/…", "mime_type" }] }
}
```

Первое сообщение (VFS): тот же payload с `mentioned.files`.

`files.editor` — **не** для VFS-профиля.

## Навыки (чтение документа)

- Path: дословно `mentioned.files[0].file_name` (`/session/r7/{sessionSeg}/…`)
- Чтение: `bash head -c …` по session path или `read_r7_snapshot_text({ session_file })` → **`body.text`**
- Instruction агента должна опираться на session VFS, не на `r7-disk:` / `R7_DISK_*` (если не disk-ref)

## Запрещено

- Dual upload (user + session) с разными `file_id` в одном сообщении
- `files.editor` на каждое сообщение без необходимости
- `file_path` в POST /message
- Полный текст документа в `content`

## Smoke / проверка

1. `prepareOutbound` с `sessionId` → один document `file_id`
2. `download(file_id)` → JSON `r7-snapshot/v1` + непустой `body.text`
3. Payload: короткий `content`, `mentioned.files` с каноническим `/session/r7/…`
4. Агент: READ snapshot → `body.text` (bash-smoke на mount **не** gate)

## Код

| Файл | Роль |
|------|------|
| `src/transfer/index.ts` | `prepareOutbound` |
| `src/transfer/context-sync.ts` | `ensureDocumentContext` |
| `src/transfer/snapshot.ts` | `r7-snapshot/v1` |
| `src/transfer/selection.ts` | `r7-selection/v1` |
| `src/transfer/message-payload.ts` | `shouldAttachEditor`, `shouldMentionDocumentFiles` |
| `src/config.ts` | `resolveTransferProfile`, `DEFAULT_TRANSFER_PROFILE` |

## VFS по умолчанию и требования к агенту

Плагин **по умолчанию** загружает контекст в session VFS (`DEFAULT_TRANSFER_PROFILE` = **`vfs`**). Выбор профиля: [`config.ts`](../src/config.ts) → `resolveTransferProfile`.

**Включить VFS в плагине — половина настройки.** Агенту нужно читать session VFS, иначе snapshot бесполезен:

| Что даёт плагин (VFS) | Что должен уметь агент |
|-----------------------|-------------------------|
| Upload `r7-snapshot/v1` в session VFS | READ path из `mentioned.files` → `body.text` |
| `mentioned.files` с путём к JSON | Instruction: источник истины — session, не disk API |
| Кнопка «Синхр. документ» | Навыки/bash под `/session/r7/…` |

Примеры VFS: LCA (`f5BwCaKDeDDG71zHJPvid`), новые агенты под этот плагин.  
Примеры **disk-ref (opt-out):** id в `DISK_REF_AGENT_IDS` — `r7-compare-docs`, analytics_csv, ГОСТ34 и т.п.

**Не смешивать:** агент с disk-instruction + VFS в плагине (или наоборот) — типичный источник сбоев.

### disk-ref как опция

| Способ | Как |
|--------|-----|
| Allowlist | Добавить `agent_id` в `DISK_REF_AGENT_IDS` в `config.ts`, пересобрать плагин |
| Title | Title агента содержит `r7-compare-docs` |
| localStorage (без пересборки) | см. ниже |

```javascript
// отключить VFS для конкретного агента
localStorage.setItem("ladcraft_r7_transfer_profile:<agentId>", "disk-ref");

// явно включить VFS (legacy alias "doc-compare" → vfs)
localStorage.setItem("ladcraft_r7_transfer_profile:<agentId>", "vfs");
location.reload();
```

### Порядок resolve (как в коде)

`resolveTransferProfile(agentId, agentTitle)` в [`config.ts`](../src/config.ts):

1. **localStorage** `ladcraft_r7_transfer_profile:{agentId}` — если задан `vfs` / `disk-ref` / `editor-mount`
2. **Allowlist** `DISK_REF_AGENT_IDS` — совпадение `agent_id`
3. **Title** — подстрока `r7-compare-docs` (без учёта регистра)
4. Иначе **`vfs`** (`DEFAULT_TRANSFER_PROFILE`)

В каталоге плагин сейчас опирается в основном на `agent_id` и `title`. Поле `description` с marketplace приходит, но **для выбора transfer не используется**. `kind` у оркестратора обычно `assistant` — для vfs/disk бесполезен.

### Варианты привязки профиля (на будущее)

**Решение отложено — подумаем позже.** Ниже кандидаты без реализации в коде.

| Вариант | Суть | Плюс / минус |
|---------|------|----------------|
| UI-переключатель Session / Disk | При выборе агента писать в существующий localStorage override (`saveAgentTransferProfileOverride`) | Понятно коллегам; нужна доработка UI |
| Маркер в `description` агента | Например `[transfer:disk-ref]` в description | Без пересборки allowlist; хрупко при правке текста |
| Расширение title-маркера | Не только `r7-compare-docs`, а ещё теги вроде `Table Disk` / `(disk)` | Просто; хрупко при переименовании |
| Tags агента / skill | Читать tags из API, если стабильно отдаются | Чище title; сейчас плагин tags не читает |
| Привязанные apps (skills) | disk-ref, если среди apps агента есть skill с disk/r7-disk toolkit | Надёжнее title; лишний API-вызов при выборе |
| Поле API `transfer_profile` | Явный контракт на агенте | Идеально; нужен бэкенд Ladcraft |
| Эвристика по `instruction` | Искать слова «диск» / «не VFS» в instruction | **Не рекомендовать** — ненадёжно и тяжело |

Пока рабочий канон для новых disk-агентов: allowlist + пересборка плагина; до пересборки — localStorage override.

## См. также

- [ARCHITECTURE.md](ARCHITECTURE.md)
- [../../../knowledge-base/plugins/curated/ladcraft-r7-plugin-input-requirements.md](../../../knowledge-base/plugins/curated/ladcraft-r7-plugin-input-requirements.md)
- [../../../r7-compare-docs/docs/r7-disk-ref-contract.md](../../../r7-compare-docs/docs/r7-disk-ref-contract.md) — disk-ref supplement и авто-поиск `templates`

## Профиль disk-ref (opt-out)

- **Без** VFS upload документа
- `mentioned.files[0].file_id` = `r7-disk:{document_id}`
- Supplement в `content`:

```text
[Контекст R7: диск]
document_id: 12345
file_name: договор.docx
```

- Пользователь должен иметь папку **`templates`** в «Мои документы» (латиница, регистр не важен), если сценарий сравнения по диску
- Код: `src/transfer/disk-ref.ts`, профиль — `resolveTransferProfile` (`src/config.ts`)

### Приоритет `document_id` (disk-ref)

| Приоритет | Источник |
|-----------|----------|
| 1 | `doc.html?id=` / `Documents/Download?id=` из URL браузера (`window.top`, parent chain) |
| 2 | `documentCallbackUrl`, `referrer`, `info.url` |
| 3 | `info.documentId` как чистое число |
| 4 | `externalData` / `jwt` / `referenceData` |
| 5 | Суффикс `GUID_…_NNN` в `info.documentId` / `info.key` (fallback) |
| 6 | `localStorage` override, `sessionStorage` cache (привязан к `documentId+key`) |

При расхождении `urlId` и `diskSuffix` плагин выбирает **urlId**; в debug-строке чата: `urlId=… · diskSuffix=… · chosen url over diskSuffix`.
