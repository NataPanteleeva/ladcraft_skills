# Установка ladcraft-r7_agui

**Папка:**

```
d:\cursor-lc-headless-main\cases\plugin\ladcraft-r7_agui
```

Отдельный GUID от `ladcraft-r7_new` — можно ставить рядом с рабочим плагином.

## Сборка

```bash
cd cases/plugin/ladcraft-r7_agui
npm install
npm run build
npm run verify
```

Версия в UI: **0.7.35-agui**.

## Установка в R7

1. Закройте R7 при переустановке.
2. Добавьте плагин с путём к **этой** папке (не `_new`).
3. На экране агента должно быть **v0.7.35-agui**.
4. Проверьте чат на текущих LCA / Excel Pivot.

## Spike API (без R7)

```bash
node cases/plugin/ladcraft-r7_agui/scripts/spike-agui.js
```

## Важно

- Чат идёт через AG-UI (`/v2/agent/run`).
- `runId` / message id — nanoid (не UUID с дефисами).
- Server-агенты disk-ref — позже; см. `_future-server-agents/`.
