# ladcraft-r7_new

Плагин R7 Office для агента **LCA** (лингвистическая проверка): форк `ladcraft-r7_btn_stream` с контрактом **tool_calls → apply → r7.event**.

- Целевой агент: [`cases/LCA/`](../../LCA/) — prod id **`f5BwCaKDeDDG71zHJPvid`** («Лингвистическая проверка текстов (LCA)»)
- Для AI: [AGENTS.md](AGENTS.md)
- Архитектура: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)
- **Контракт для создателей агентов:** [docs/AGENT-PLUGIN-CONTRACT.md](docs/AGENT-PLUGIN-CONTRACT.md) — как агент получает/отдаёт данные плагину

## Отличия от btn_stream

| Тема | Поведение |
|------|-----------|
| Inbound | `parseToolCalls` **первым**; fence `r7.task` — fallback |
| После apply | quiet POST ```r7.event``` (`apply-feedback.ts`) |
| UI | service feedback скрыт в user-bubble |

## Сборка

```bash
cd cases/plugin/ladcraft-r7_new
npm install
npm run build
```

Версия UI: `0.6.20-action-repeat` (`config.json` / `src/version.ts`).

## Передача документа

**По умолчанию — session VFS** (`r7-snapshot/v1` → `/session/r7/…`). Агент читает `body.text` из snapshot.

**disk-ref** (без upload) — только явная опция: id в `DISK_REF_AGENT_IDS`, title `r7-compare-docs`, или `localStorage` `ladcraft_r7_transfer_profile:{agentId}` = `"disk-ref"`.

Подробнее: [docs/01-transfer-rules.md](docs/01-transfer-rules.md).
