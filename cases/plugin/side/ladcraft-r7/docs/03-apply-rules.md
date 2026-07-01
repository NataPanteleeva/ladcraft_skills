# Блок 3: Обработка ответа и вставка в R7

> Реализовано: контекстные блоки действий (`src/apply/`).

## Ответственность

- Резолвер `MessageActionPlan` из ответа агента (history API)
- CompareReport (`doc-compare/v1`) из `tool_calls` / `metadata` / скрытого `deliver_inline`
- Вставка в Word (`PasteHtml`) и локальное скачивание (.md / .html для Word)
- UI-блоки под сообщением ассистента

## Не входит

- Upload документа в VFS (блок 1)
- Отправка сообщений (блок 2)
- Авто-применение `r7.task` (task-runner) — отдельный шаг

## Контракт `MessageActionPlan`

```typescript
type ActionBlock =
  | { kind: "insert"; label: string; payload: ActionContentSource }
  | { kind: "download"; label: string; payload: ActionContentSource; baseName?: string };

interface MessageActionPlan {
  blocks: ActionBlock[];
}
```

`ActionContentSource` — `text` (markdown) или `card` (`DeliverableCard` из `r7.task`).

## Когда показывать блоки

| Условие | Блоки |
|---------|--------|
| Виджет / выбор шаблона / `waitingForInput` | **нет** |
| Отчёт есть, но пользователь **не** писал «вставить» / «скачать» | **нет** |
| Пользователь написал **«вставить»** (или `insert`, «вставить в документ») после отчёта | блок **insert** |
| Пользователь написал **«скачать»** (или `download`, `.md`, `.docx`) после отчёта | блок **download** на bubble отчёта (`.md` / `.html`); кнопка **Скачать .docx** → `скачать docx` в чат; файл `.docx` — на export-bubble |
| Оба слова в одном или разных сообщениях после отчёта | оба блока |
| Только cell-редактор | download (без insert) |

Навык/агент должен **предложить** пользователю написать в чате «вставить» или «скачать» — не вопросом («Хотите скачать?»), а инструкцией: «Напишите: вставить / скачать».

**Не считается download-intent:** выбор шаблона `*.md` без глагола «скачать» (например `sub_roznich.md`).

Распознавание: `src/apply/user-action-intent.ts` (`parseUserActionIntent`, `findUserActionIntentAfter`).

## Источники контента (приоритет)

1. CompareReport JSON → `compareReportToMarkdown`
2. `extractReportActionContent` из чата
3. `deliver_file` / `deliver_inline` из `r7.task`
4. Fallback: разрешённый текст ассистента

### Safe-minimal перенос из v2

- Переносим только эвристики извлечения/обрезки отчёта (`content-extract`), без изменения UX-контракта.
- Intent-gated показ кнопок (`вставить` / `скачать`) остаётся обязательным.
- Допустимые расширения эвристик: дополнительные якори секций отчёта и варианты маркера «Что дальше?».

## Кнопки

**Вставить в документ** (Word): в начало · в конец · в позицию курсора

**Скачать**: `.docx` (из `deliver_file` после r7-export **или** из `content_base64` в `tool_calls` при недоступном VFS upload) · `.md` · `.html` (локальный fallback)

## Как добавить новый блок

1. Расширить union `ActionBlock` в `src/apply/types.ts`
2. Добавить ветку в `resolveMessageActions` (`resolve-actions.ts`)
3. Добавить рендер в `src/ui/message-actions.ts`

`chat.ts` менять не нужно — рендер идёт через `renderMessageActions`.

## Код

| Путь | Назначение |
|------|------------|
| `src/apply/resolve-actions.ts` | резолвер контекста |
| `src/apply/compare-report.ts` | CompareReport JSON |
| `src/apply/content-extract.ts` | эвристики отчёта из чата |
| `src/apply/insert.ts`, `download.ts` | исполнители |
| `src/ui/message-actions.ts` | UI кнопок |
| `src/ui/chat-history.ts` | вызов резолвера при маппинге history |

## См. также

- [ladcraft-r7-compare-agent-orchestration.md](../../../knowledge-base/plugins/curated/ladcraft-r7-compare-agent-orchestration.md) — вставка из CompareReport
- [04-skill-output-contract.md](04-skill-output-contract.md) — формальные требования к ответу навыка для кнопок вставки/скачивания
- Эталон v2: `plugins/ladcraft-r7-plugin-v2/src/r7/`, `src/ui/content-actions.ts`
