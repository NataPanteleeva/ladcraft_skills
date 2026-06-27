# Блок 2: Отработка сообщений чата

> Отдельный план. Заглушка границ — не смешивать с блоком 1.

## Ответственность

- Сессия Ladcraft (`createSession`, `deleteSession`)
- `POST /message` / poll history
- Виджеты уточнения, отображение bubble
- `waitForAssistantTurn`, статусы «ожидание»

## Не входит

- Формат snapshot, VFS upload (блок 1)
- `r7.task`, вставка в R7 (блок 3)

## Правила (кратко)

- Перед send вызывать `prepareOutbound` из блока 1 — не дублировать VFS-логику в `main.ts`
- Widget submit → тот же `handleSend` → снова `mentioned.files`
- Bubble пользователя — только видимый текст; selection supplement только в API `content`

## Код

- `src/main.ts` — оркестратор
- `src/eai/session.ts` — transport
- `src/ui/*` — отображение
