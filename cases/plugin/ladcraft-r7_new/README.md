# ladcraft-r7_new

Плагин R7 Office для агента **LCA** (лингвистическая проверка): форк `ladcraft-r7_btn_stream` с контрактом **tool_calls → apply → r7.event**.

- Целевой агент: [`cases/LCA/`](../../LCA/) — prod id **`f5BwCaKDeDDG71zHJPvid`** («Лингвистическая проверка текстов (LCA)»)
- Для AI: [AGENTS.md](AGENTS.md)
- Архитектура: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)

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

Версия UI: `0.6.6-explicit-paste` (`config.json` / `src/version.ts`).

## Передача документа

Как в btn_stream: по умолчанию disk-ref; VFS snapshot — opt-in / allowlist. Для LCA предпочитайте агента с READ через `/session/r7/…` (VFS profile), см. [docs/01-transfer-rules.md](docs/01-transfer-rules.md).
