# Справка: ответ агента → кнопки → вставка с оформлением

Краткий конспект для `ladcraft-r7_new` (LCA). Код: `src/apply/`, `src/markdown/html.ts`, `src/apply/editor-methods.ts`.

---

## 1. Откуда плагин берёт ответ агента

| Источник | Поле / место | Зачем |
|----------|--------------|--------|
| Сообщение ассистента в чате | `ChatMessage.applyText` (предпочтительно) или `message.text` | Сырой текст для apply; UI может показывать санитизированный `text` без fence |
| Скрытый контракт | fence ` ```r7.proposal ` … ` ``` ` внутри ответа | Структурированный WHAT/WHERE (`r7.proposal/v1`) |
| Fallback без proposal | тот же raw-ответ | Секция **Черновик:** / structured summary / короткий insertable blob |

Функция входа: `assistantApplySource(message)` → `(applyText || text).trim()`.

Важно: плагин **не** читает HTML из DOM пузыря чата. Хранится и применяется **текст ответа** (markdown / proposal JSON), а не то, что уже отрисовано на экране.

---

## 2. Что выцепляют кнопки «Действия»

Кнопки **локальные** (без хода к агенту). Цепочка:

1. `resolveActionTarget(messages)` — последнее подходящее сообщение ассистента (не виджет, не «агент выполняет…»).
2. `parseR7Proposal(raw)` — если есть proposal, от него зависят кнопки и payload.
3. `resolveInsertableText(raw)` / `planFromActionId(actionId, target)` — тело для вставки или план задач.

| Kind proposal / ситуация | Что выцепляют кнопки | Типичное действие |
|--------------------------|----------------------|-------------------|
| `findings` | пункты `items[]` (`search` / `replace`) | «Все» → `search_replace` |
| `comment` | `proposal.text` | комментарий к выделению |
| `cell_map` | карта ячеек `data` | запись в Cell |
| `blob` | `proposal.text` | paste / replace / download |
| нет proposal, есть Черновик / summary / insertable draft | `extractInsertableMarkdown(raw)` — кусок после «Черновик:» (или очищенный ответ) | `paste_text` / `replace_selection` / скачивание |

Кнопки Word (для insertable текста): **Курсор**, **Заменить**, **Конец**, плюс **MD** / **Word** (скачать).  
Они берут **уже выбранный срез** текста ответа, а не «всё окно чата».

---

## 3. Как вставляется с форматированием

Это **не** копирование CSS/DOM из чата. Два потребителя одного markdown:

```
Ответ агента (markdown / proposal.text)
        │
        ├─► чат: markdownToHtml → innerHTML пузыря
        │
        └─► apply: contentToPasteHtml → HTML
                      │
                      └─► Asc.plugin.executeMethod("PasteHtml", [html])
```

### Роли шагов

| Шаг | Что делает | Что не делает |
|-----|------------|---------------|
| Выбор куска (`resolveInsertableText` и т.п.) | Какой текст вставлять | Не превращает в HTML |
| `contentToPasteHtml` / `markdownToHtml` | Markdown → HTML с тегами и inline-стилями | Не выбирает кусок заново |
| `PasteHtml` | R7 вставляет HTML в документ как оформление Word | Не «снимает» стили с чата |

### Что восстанавливается из markdown

| В ответе агента | В HTML | В документе |
|-----------------|--------|-------------|
| `**жирный**` | `<strong>` | жирное начертание |
| `> цитата` | `<blockquote style="…background…; border-left…">` | абзац с фоном и рамкой |
| таблица `\| … \|` + `\|---\|` | `<table>` / `<th>` / `<td>` со стилями границ | оформленная таблица |
| `# Заголовок` | `<h1>`…`<h6>` | заголовок |
| обычная строка | `<p>…</p>` | абзац |

### Когда конвертер не нужен

- В `proposal` / задаче уже **готовый HTML** и операция `paste` (mime/html) — уходит в `PasteHtml` как есть.
- Не класть markdown в `op:"paste"`: иначе `**` и `|` попадут в документ буквально.

### Канон API (Word)

- Вставка у курсора / в конец / в начало: при необходимости сдвиг курсора → **`PasteHtml`**.
- Замена выделения: **`RemoveSelectedContent`** + **`PasteHtml`** (тот же MD→HTML, если не HTML).

---

## Где смотреть в коде

| Файл | Тема |
|------|------|
| `src/apply/action-buttons.ts` | кнопки, `resolveActionTarget`, `resolveInsertableText`, `planFromActionId` |
| `src/apply/intent-apply.ts` | `assistantApplySource`, `extractInsertableMarkdown`, intent-apply |
| `src/apply/proposal-parse.ts` | `r7.proposal/v1` |
| `src/markdown/html.ts` | `markdownToHtml`, `contentToPasteHtml` |
| `src/apply/editor-methods.ts` | `insertText` → `PasteHtml` |
| `src/ui/markdown.ts` | отрисовка того же MD в чате |

См. также: [03-apply-rules.md](03-apply-rules.md), [04-skill-output-contract.md](04-skill-output-contract.md).
