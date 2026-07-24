# ladcraft-r7_new

Плагин R7 Office для агента **LCA** (лингвистическая проверка): форк `ladcraft-r7_btn_stream` с контрактом **tool_calls → apply → r7.event**.

- Целевой агент: [`cases/LCA/`](../../LCA/) — prod id **`f5BwCaKDeDDG71zHJPvid`** («Лингвистическая проверка текстов (LCA)»)
- Для AI: [AGENTS.md](AGENTS.md)
- Архитектура: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)
- **Контракт для создателей агентов:** [docs/AGENT-PLUGIN-CONTRACT.md](docs/AGENT-PLUGIN-CONTRACT.md) — как агент получает/отдаёт данные плагину
- **Канон потоков (не терять логику):** [docs/DATA-FLOW-CANON.md](docs/DATA-FLOW-CANON.md) — outbound/inbound, уточнения, `Файл:` vs auto-apply, фразы клиенту

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

Версия UI: `0.6.62-sheet-callback` (`config.json` / `src/version.ts`).

## Передача документа

**По умолчанию — session VFS** (`vfs`). Word: JSON snapshot; Cell: `.xlsx` — [TABLE-AGENTS-PLUGIN.md](docs/TABLE-AGENTS-PLUGIN.md), канон — [DATA-FLOW-CANON.md](docs/DATA-FLOW-CANON.md).

**disk-ref** (без upload) — opt-in: `DISK_REF_AGENT_IDS`, title `r7-compare-docs`, или `localStorage` `ladcraft_r7_transfer_profile:{agentId}` = `"disk-ref"`.

Подробнее: [docs/01-transfer-rules.md](docs/01-transfer-rules.md), [docs/TABLE-AGENTS-PLUGIN.md](docs/TABLE-AGENTS-PLUGIN.md).
