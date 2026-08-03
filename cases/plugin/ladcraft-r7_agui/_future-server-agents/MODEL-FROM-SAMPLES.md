# Модель данных плагина (по семплам 2026-07-30 + реализация фазы 2)

## Канон источников (новые сессии)

```text
Во время run:  SSE AG-UI
  TEXT_MESSAGE_*              → bubble (+ applyText для proposal)
  CUSTOM eai.message.file_references → early file buttons (excel)
  TOOL_CALL_*                 → статусы «инструмент работает» (опционально)
  НЕ ждать полного skill JSON в TOOL_CALL_RESULT (его там нет)

После RUN_FINISHED / reopen:
  GET /v2/agent/thread/{sessionId}/projection
  messages[].orderedBlocks (text)     → финальный текст / proposal
  messages[].responseFileReferences   → кнопки файла
  tools[]                             → только статусы/имена, не userReply
  terminal                            → finished / interrupt

v1 /history — не использовать
```

## Excel → кнопки

| Нужно UI | Откуда брать |
|----------|----------------|
| Скачать / открыть xlsx | `responseFileReferences.files[].file_id` (+ display_name) |
| Подпись / «Файл: path» | text block / stream text |
| Early ready | первое `eai.message.file_references` в стриме |

## LCA → apply

| Нужно UI | Откуда брать |
|----------|----------------|
| Findings / blob proposal | текст assistant (`r7.proposal` fence) из stream или text block |
| Insert body | **только** `proposal.text` (не markdown чата) |
| Подтверждение пользователя | local intent-apply |

`r7.proposal` **не** меняется протоколом AG-UI — это контент-контракт навык↔плагин.

## Что сознательно не делаем

- Адаптер projection → старый `HistoryMessage.tool_calls`
- Merge со старыми сессиями
- Markdown-fallback для insert (HR pickBestBody)
- Опора на v1 history
