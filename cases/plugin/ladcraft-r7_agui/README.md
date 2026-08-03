# ladcraft-r7_agui

Форк [`ladcraft-r7_new`](../ladcraft-r7_new/) с чатом на **AG-UI** (`POST /v2/agent/run` + SSE `TEXT_MESSAGE_*`).

- Prod `ladcraft-r7_new` **не** меняем — эта копия для сдачи/проверки нового протокола.
- Проверка на **текущих** агентах LCA / excel (server disk-ref агенты — потом).
- Заметки под server-этап: [`_future-server-agents/README.md`](_future-server-agents/README.md)

## Отличия от `_new`

| Тема | Поведение |
|------|-----------|
| Chat transport | **AG-UI** по умолчанию (`features.agUiStreaming`) |
| Send | `POST /v2/agent/run` (не `POST …/message`) |
| Stream | события `TEXT_MESSAGE_*` + CUSTOM `draft.*` / `text.replaced` |
| runId / message id | **nanoid-подобные** (21 символ); UUID с дефисами API отклоняет |
| Outbound документ | как в `_new`: vfs / disk-ref |
| Apply | без изменений (history sync после `RUN_FINISHED`) |

## Сборка

```bash
cd cases/plugin/ladcraft-r7_agui
npm install
npm run build
```

Версия UI: см. `config.json` / `src/version.ts` (`0.7.0-agui`).

## Spike

```bash
node cases/plugin/ladcraft-r7_agui/scripts/spike-agui.js
```

## Feature flags (localStorage `ladcraft_r7_features`)

- `agUiStreaming: true` — default
- `sseStreaming: true` — откат на legacy GET `/sse` + `POST /message` (не рекомендуется платформой)
