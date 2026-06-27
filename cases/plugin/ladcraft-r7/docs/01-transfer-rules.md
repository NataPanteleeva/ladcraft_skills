# Блок 1: Передача данных (R7 → Ladcraft VFS → payload)

> **Статус:** **рабочий вариант (проверено)** для doc-compare — session VFS, экспорт 2026-06-25.  
> Схема: [`ladcraft-r7-doc-compare-transfer.md`](../../../knowledge-base/plugins/curated/ladcraft-r7-doc-compare-transfer.md).

## Ответственность

- Снять снимок документа / выделения из R7
- Upload в **session VFS** (`scope=session`, `session_id`)
- Собрать `OutboundTransfer` для `POST /message`
- Smoke: `GET …/vfs/files/{file_id}/download`

## Не входит

- UI чата, polling, виджеты (блок 2)
- Парсинг ответа, `r7.task`, вставка (блок 3)

## Обязательные правила

- [ ] Один канонический `file_id` на документ — **session VFS** (привязка к `session_id` чата, поле `vfsSessionId` в registry)
- [ ] Upload: `scope=session`, `session_id`, path `/r7/r7-{docKey}.json`, **`sync:true`** — HTTP 200 = файл в mount
- [ ] Перед send: upload → `parsing_status: complete` → `verifyFileReadable(file_id)` (schema + `body.text` ≥ 100 символов)
- [ ] **Открытие чата:** `createSession` → `ensureDocumentContext` (`forceReupload`) → только потом `chatReady` и ввод
- [ ] Каждый `POST …/message` (включая 1-й): `mentioned.files[]` с `file_id`, `file_name` = `/session/r7/…`, `mime_type: application/json`
- [ ] `files.editor` — профиль `editor-mount` (r7-analyze); для doc-compare **не отправлять**
- [ ] `content` — текст задания пользователя; **не** вкладывать полный документ в `content`
- [ ] Допустим supplement выделения в `content` (блок `[Контекст R7: выделенный фрагмент]`)
- [ ] Имена: документ `r7-{sanitizedDocKey}.json`, выделение `r7-selection_{docKey}.json`
- [ ] Snapshot: `schema: r7-snapshot/v1`, обязателен `body.text`; навыки читают через **`read_r7_snapshot_text`** (skill VFS)
- [ ] Точка изменений: `src/transfer/` (`prepareOutbound` — единая entry point)

## Отклонено (схема 1)

- Блок `[Контекст R7: документ]` в `content` — **не использовать**
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

Первое сообщение (doc-compare): тот же payload с `mentioned.files` — навык не читает B до выбора шаблона.

`files.editor` — **не** для doc-compare.

## Навыки (чтение документа B)

- Поиск: `resolve_r7_document` / `startup_compare` (`found` только при готовом `body.text`)
- Чтение: **`read_r7_snapshot_text({ session_file })`** — skill VFS, не bash на `/session/r7/`
- Эталон A: `head -c 300000 /workspace/Templates/{шаблон}.md`

## Запрещено

- Dual upload (user + session) с разными `file_id` в одном сообщении
- `files.editor` на каждое сообщение без необходимости
- `file_path` в POST /message
- Полный текст документа в `content`

## Smoke / проверка

1. `prepareOutbound` с `sessionId` → один document `file_id`
2. `download(file_id)` → JSON `r7-snapshot/v1` + непустой `body.text`
3. Payload: короткий `content`, `mentioned.files` с каноническим `/session/r7/r7-….json`
4. Навык: `read_r7_snapshot_text` → `ok: true` (bash-smoke на `/session/r7/` **не** gate — известная рассинхронизация mount)

## Код

| Файл | Роль |
|------|------|
| `src/transfer/index.ts` | `prepareOutbound` |
| `src/transfer/context-sync.ts` | `ensureDocumentContext` |
| `src/transfer/snapshot.ts` | `r7-snapshot/v1` |
| `src/transfer/selection.ts` | `r7-selection/v1` |
| `src/transfer/message-payload.ts` | `shouldAttachEditor`, `shouldMentionDocumentFiles` |

## См. также

- [ARCHITECTURE.md](ARCHITECTURE.md)
- [../../../knowledge-base/plugins/curated/ladcraft-r7-plugin-input-requirements.md](../../../knowledge-base/plugins/curated/ladcraft-r7-plugin-input-requirements.md)
