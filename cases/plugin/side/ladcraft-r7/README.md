# Ladcraft R7

Базовый плагин R7 Office для чата с агентами Ladcraft: авторизация, выбор агента, передача контекста документа (**по умолчанию disk-ref, без VFS**), виджеты уточнения.

Маршрутизация навыков — на стороне выбранного агента. Логика конкретных сценариев (сравнение, export, `r7.task`) — вне этого плагина или в блоке 3 (планируется).

## Архитектура (3 блока)

| Блок | Документация | Код |
|------|--------------|-----|
| 1. Передача данных | [docs/01-transfer-rules.md](docs/01-transfer-rules.md) | `src/transfer/` |
| 2. Чат | [docs/02-chat-rules.md](docs/02-chat-rules.md) | `src/main.ts`, `src/ui/` |
| 3. Вставка | [docs/03-apply-rules.md](docs/03-apply-rules.md), [docs/04-skill-output-contract.md](docs/04-skill-output-contract.md) | `src/apply/`, `src/ui/message-actions.ts` |

Обзор: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) · Для AI: [AGENTS.md](AGENTS.md)

## Передача документа (блок 1)

**По умолчанию — disk-ref (без VFS):** `r7-disk:{document_id}` + supplement `[Контекст R7: диск]`; навыки читают Р7-Диск через API (`R7_DISK_*`).

**Opt-in VFS** (`doc-compare`) — только для агентов в allowlist `VFS_SNAPSHOT_AGENT_IDS` или с title `compare-r7` / «Сравнение 27»; override: `localStorage` ключ `ladcraft_r7_transfer_profile:{agentId}`.

> **Важно:** включение VFS в плагине **недостаточно**. Агенту нужно **привязать навыки с VFS** (чтение session snapshot, bash/`read_r7_snapshot_text` и т.п.) — как у legacy compare-r7 / «Сравнение 27» (`r7-compare-toolkit`, `doc-compare`). Без таких навыков snapshot в VFS агент использовать не сможет. Агенты в стиле `examples_sergey` и `r7-compare-docs` VFS **не** требуют — только disk-навыки с `R7_DISK_*`.

Подробнее: [docs/01-transfer-rules.md](docs/01-transfer-rules.md#vfs-opt-in-и-агент).

- Snapshot `r7-snapshot/v1` → session VFS — **только** для `doc-compare`
- Каждое сообщение: `mentioned.files` (`file_id`, `file_name`, `mime_type`)
- `files.editor` — **не** для doc-compare (только VFS + skill tools)
- Перед send: `download(file_id)` + проверка `schema` и `body.text`
- Выделение: `r7-selection_*.json` + supplement в API `content`
- **doc-compare:** plain text документа в блоке `[Контекст R7: документ]` в `content` (схема 1)
- **disk-ref** (`r7-compare-docs`): без VFS upload; `mentioned.files` с `r7-disk:{document_id}`; supplement `[Контекст R7: диск]` с `document_id` и `file_name`. Папку **`templates`** в «Мои документы» находит навык — плагин id не передаёт.

Откат до схемы без content-блока: `plugins/ladcraft-r7-v1_25.06/`.

Полная спека: [knowledge-base/plugins/curated/ladcraft-r7-plugin-input-requirements.md](../../knowledge-base/plugins/curated/ladcraft-r7-plugin-input-requirements.md)

## Сборка

```bash
npm install
npm run build
```

## Поток

1. **Вход** — email/пароль, регистрация, проверка API.
2. **Оболочка** — список агентов, выбор, «Открыть чат».
3. **Чат** — история, опрос, виджеты; документ синхронизируется через `prepareOutbound`.
4. **Назад** — сброс сессии Ladcraft; привязка VFS документа в localStorage сохраняется.

## localStorage

| Ключ | Назначение |
|------|------------|
| `ladcraft_r7_auth` | Токены |
| `ladcraft_r7_user` | Профиль |
| `ladcraft_r7_plugin_config` | API URL, последний агент |
| `ladcraft_r7_doc_context:{userId}:{docKey}` | VFS `file_id` документа |
| `ladcraft_r7_session:{userId}:{docKey}::agent:{id}` | session_id чата |

## disk-ref (r7-compare-docs)

- Документ должен быть открыт **с Р7-Диска** (в URL — numeric `id` документа).
- В **«Мои документы»** на диске нужна папка **`templates`** (латиница, регистр не важен) с шаблонами `.md` / `.docx`.
- Плагин **не** настраивает id папки templates — навык `r7-compare-disk` находит её после login.
