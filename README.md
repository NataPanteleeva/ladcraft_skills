# cursor-lc-headless

Чистый каркас для разработки и запуска агентов и навыков **Ladcraft прямо из Cursor**,
без веб-UI («headless»). Репозиторий собран из трёх частей текущего рабочего окружения:

- **Правила Cursor** — `.cursor/rules/`
  - `ladcraft-skills.mdc` — корневое правило: раскладка кейсов, manifest-first чтение канона, жёсткие инварианты навыков.
  - `ladcraft-prod-publishing.mdc` — когда и как публиковать/менять навыки и агентов на prod.
- **Курсорные скилы** — `.cursor/skills/`
  - `ladcraft-prod-publish/` — control plane на `api.ladcraft.ru`: создать/обновить навык, создать/привязать агента, задать install-конфиг (`environment.user`), модель, relations-делегирование и политику делегирования.
  - `ladcraft-agent-drive/` — data plane: гонять живого агента по API (сессия, загрузка файла, сообщение, SSE-мониторинг, история tool-calls), загружать БЗ в `/workspace` и управлять VFS.
- **Канон `.pi/`** — единый источник истины для всех кейсов
  - `AGENTS.md`, `APPEND_SYSTEM.md` — обязательный порядок работы и системные ограничения.
  - `ladcraft-docs/` — документация и approved-шаблоны навыков (manifest + `ru/`).

## Раскладка

```
.cursor/rules/      правила Cursor (всегда применяются / по запросу)
.cursor/skills/     курсорные скилы (prod-publish, agent-drive)
.pi/                корневой канон Ladcraft (НЕ дублировать по кейсам)
cases/              кейсы: каждый — папка навыка + папки агентов
  dev_burnout_rescue/   демо-кейс «Спасатель выгоревшего разработчика»
```

Любая работа с навыками/агентами подчиняется канону `<repo>/.pi/`. Новый навык/агент создавай в
`cases/<case_name>/` (см. `ladcraft-skills.mdc`).

## Настройка доступа

Скопируй `.env.example` в `.env` и заполни (файл `.env` в git не попадает):

```
LADCRAFT_EMAIL=...
LADCRAFT_PASSWORD=...
LADCRAFT_API_URL=https://api.ladcraft.ru   # prod; dev: https://api.dev.e-ai.ladcloud.ru
```

Проверить авторизацию:

```bash
node .cursor/skills/ladcraft-prod-publish/scripts/ladcraft_prod.js auth
```

## MCP-серверы (опционально)

Рекомендуется установить MCP-сервер **chrome-devtools** — он даёт агенту управление браузером
(навигация, снапшоты, сеть, консоль, perf-трейсы), что удобно для отладки и проверки веб-UI Ladcraft.
Официальный репозиторий: [ChromeDevTools/chrome-devtools-mcp](https://github.com/ChromeDevTools/chrome-devtools-mcp).

Добавь сервер в `~/.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "chrome-devtools": {
      "command": "npx",
      "args": ["-y", "chrome-devtools-mcp@latest"],
      "env": {}
    }
  }
}
```

После правки перезапусти MCP-сервер в Cursor (Settings → MCP).

## Демо-кейс

`cases/dev_burnout_rescue/` — мульти-агентная демонстрация, которая за один прогон показывает
**все** ключевые возможности канона: VFS, sql-storage, widget, `environment.user`, `general.lib`,
второй рантайм `python@3`, мульти-агент (`delegateToAgents`) и host-инструменты
(`fileSearch`, `requestUserInput`, `requestApproval`, `fileConverter`). Подробности и сценарий —
в `cases/dev_burnout_rescue/README.md`.

Публикация на prod в этом репозитории — отдельный осознанный шаг (см. `ladcraft-prod-publishing.mdc`),
по умолчанию здесь лежат только исходники кейса.
