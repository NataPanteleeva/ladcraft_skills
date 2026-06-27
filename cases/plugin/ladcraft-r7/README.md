# Ladcraft R7

Базовый плагин R7 Office для чата с агентами Ladcraft: авторизация, выбор агента, **передача документа в VFS**, виджеты уточнения.

Маршрутизация навыков — на стороне выбранного агента. Логика конкретных сценариев (сравнение, export, `r7.task`) — вне этого плагина или в блоке 3 (планируется).

## Архитектура (3 блока)

| Блок | Документация | Код |
|------|--------------|-----|
| 1. Передача данных | [docs/01-transfer-rules.md](docs/01-transfer-rules.md) | `src/transfer/` |
| 2. Чат | [docs/02-chat-rules.md](docs/02-chat-rules.md) | `src/main.ts`, `src/ui/` |
| 3. Вставка | [docs/03-apply-rules.md](docs/03-apply-rules.md) | (планируется) |

Обзор: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) · Для AI: [AGENTS.md](AGENTS.md)

## Передача документа (блок 1)

- Snapshot `r7-snapshot/v1` → **session VFS** (`file_id`, bash-path `/session/r7/r7-{docKey}.json`)
- Каждое сообщение: `mentioned.files` (`file_id`, `file_name`, `mime_type`)
- `files.editor` — **не** для doc-compare (только VFS + skill tools)
- Перед send: `download(file_id)` + проверка `schema` и `body.text`
- Выделение: `r7-selection_*.json` + supplement в API `content`
- **doc-compare:** plain text документа в блоке `[Контекст R7: документ]` в `content` (схема 1)

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
