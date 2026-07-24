# Handoff: плагин ladcraft-r7 — скачивание DOCX через content_base64

Документ для **отдельного агента**, дорабатывающего только `plugin/ladcraft-r7/`.

Связано: [ladcraft-r7-docx-scenario-a-handoff.md](ladcraft-r7-docx-scenario-a-handoff.md), кейс `cases/compare-r7/`.

---

## Контекст

### Проблема

На prod skill runtime **не даёт** session VFS upload (`r7_render_and_deliver_docx` → `VFS upload (scope=session) недоступен`). Сценарий A (`deliver_file` + `fileId`) не срабатывает. Плагин показывал только `.md` / `.html`.

### Решение на стороне Ladcraft (уже сделано, не трогать в этом handoff)

| Компонент | Статус |
|-----------|--------|
| `r7-docx-render` skill | prod **v6.0.0**: при ошибке upload → `ok: true`, `delivery: "inline_base64"`, `content_base64`, `fileName` |
| Агент `Tzr2xtBAyU0_jR1az_a8S` | instruction: короткий ack при `inline_base64`, не писать «VFS заблокирован» |
| `doc-compare` | CompareReport в `r7.task` deliver_inline (json) — для .md/.html как раньше |

### Задача плагина

Добавить **второй канал** скачивания `.docx`: читать `content_base64` из `tool_calls` export-сообщения в history API и скачивать Blob в браузере **без** VFS download.

**Не** класть base64 в `r7.task` — лимит `deliver_inline.content` = **32 768** символов (`task-parse.ts`).

---

## Целевой поток

```
Пользователь: «скачать docx»
  → Агент: r7_render_and_deliver_docx(report)
  → tool result: { ok: true, delivery: "inline_base64", content_base64, fileName: "*.docx" }
  → Плагин: кнопка «Скачать .docx» под export-сообщением
  → downloadDocx: atob → Blob → triggerBrowserDownload
```

Сценарий A (`deliver_file` + VFS) **сохранить** — при появлении upload на платформе заработает без правок.

---

## Контракт tool result (что парсить)

Имена tools (буквально):

- `r7_render_and_deliver_docx` (основной)
- `r7_render_docx`, `r7_deliver_docx`, `r7-export` (legacy)

Поля в `tool_calls[].result` (JSON string или object):

```json
{
  "ok": true,
  "delivery": "inline_base64",
  "fileName": "сравнение_ТТ_десктоп.docx",
  "mimeType": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "content_base64": "<base64 без переносов или с ними>",
  "bytes": 12345
}
```

Условия валидности для плагина:

- `ok !== false`
- `content_base64` / `contentBase64` — непустая строка (≥ 16 символов после trim)
- `fileName` / `file_name` — заканчивается на `.docx` или `.doc`

При `delivery: "deliver_file"` или наличии `r7_task_block` с `fileId` — приоритет **VFS** (как сейчас).

---

## Файлы плагина — что менять

Корень: `plugin/ladcraft-r7/`.

### 1. Новый модуль `src/apply/docx-from-tools.ts`

```typescript
export interface DocxInlinePayload {
  base64: string;
  fileName: string;
  mimeType: string;
}

export function extractDocxFromToolCalls(message: HistoryMessage): DocxInlinePayload | null;
export function docxInlineToActionSource(payload: DocxInlinePayload): ActionContentSource;
```

Логика:

- Итерировать `message.tool_calls` **с конца** (последний export-вызов).
- Парсить `result`, при необходимости `arguments` / `args`.
- Не бросать исключения на битом JSON — возвращать `null`.

### 2. `src/apply/types.ts`

Расширить `ActionContentSource`:

```typescript
| { kind: "base64"; base64: string; fileName: string; mimeType?: string }
```

В `DownloadBlock` комментарий: `docxPayload` — VFS **или** base64.

### 3. `src/apply/download.ts`

- `isDocxDownloadSource(source)` → `true` для `kind: "base64"` и vfs-card.
- `downloadDocx`:
  - `base64`: `atob` → `Uint8Array` → `Blob` → `triggerBrowserDownload` (без API).
  - `card` + `fileId`: как сейчас через `downloadVfsFile`.
- `resolveText` / `downloadMarkdown`: при `kind: "base64"` — throw «используйте Скачать .docx».

### 4. `src/apply/insert.ts`

При `kind: "base64"` — throw «Для DOCX используйте Скачать .docx» (вставка DOCX не поддерживается).

### 5. `src/apply/resolve-actions.ts`

После `pickDocxDeliverable(deliverables)`:

```typescript
if (!docxPayload) {
  const inline = extractDocxFromToolCalls(message); // message = текущий bubble
  if (inline) docxPayload = docxInlineToActionSource(inline);
}
```

Важно для download block:

- `textPayload` — markdown из **report**-сообщения (`payloadSourceIndex`).
- `docxPayload` — из **текущего** export-сообщения (`messageIndex`).
- Если есть только `docxPayload` (base64), а `textPayload` нет — всё равно показать download с кнопкой .docx; для .md/.html нужен report text.

Предложенная логика `payload` для download block:

```typescript
const downloadPayload = textPayload ?? docxPayload; // docxPayload только если нет text
if (!textPayload && !docxPayload) return { blocks: [] };
```

Не использовать `docxPayload` как единственный `payload` для markdown-кнопок — иначе `downloadMarkdown` упадёт.

### 6. `src/apply/user-action-intent.ts`

`messageHasDocxExport(message)`:

```typescript
if (extractDocxFromToolCalls(message)) return true;
// + существующая проверка deliver_file из r7.task
```

В `resolveActionBinding`, когда `messageHasDocxExport` на export-сообщении:

```typescript
const reportSource = findReportPayloadSource(items, assistantIndex);
return {
  userIntent: intent,
  payloadSourceIndex: reportSource ?? assistantIndex,
};
```

Так .md/.html берутся из отчёта сравнения, а .docx — из tool_calls export-bubble.

### 7. `src/ui/message-actions.ts`

**Не менять**, если уже вызывает `downloadDocx(handlers.client, docxSource, baseName)` при `downloadBlock.docxPayload`.

### 8. `docs/03-apply-rules.md`

Дополнить строку «Скачать»: `.docx` из `content_base64` в `tool_calls` при недоступном VFS upload.

### 9. Не трогать без необходимости

| Файл | Почему |
|------|--------|
| `src/ui/chat.ts` | polling / sync сообщений |
| `src/eai/session.ts` | парсинг history |
| `src/ui/chat-history.ts` | маппинг history → UI (кроме уже существующего вызова `resolveMessageActions`) |

---

## Регрессия: «плагин перестал считывать сообщения чата»

При первой попытке доработки пользователь откатил плагин — чат перестал показывать сообщения.

**Гипотезы для проверки агентом:**

1. **`historyToChatMessages` filter** (`chat-history.ts` конец):
   ```typescript
   messages.filter((m) => m.text.trim() || m.widget || m.widgetChoices?.length || m.actionPlan?.blocks.length);
   ```
   Export-ack с пустым `text` и без `actionPlan` **выпадает** из списка. Убедиться, что assistant-сообщения с `tool_calls` и видимым `content` не теряют `text` при `extractVisibleText`.

2. **`resolve-actions.ts`** — ранний `return { blocks: [] }` не должен влиять на `text` сообщения; но если случайно меняли `chat-history.ts` или фильтр — проверить.

3. **Исключения в `extractDocxFromToolCalls`** при обходе history — обернуть в try/catch, не пробрасывать в `historyToChatMessages`.

4. **Огромные `tool_calls[].result`** с base64 — не парсить/логировать целиком в UI thread; только поля `ok`, `fileName`, наличие `content_base64`.

**Обязательный smoke после правок:**

- Первое сообщение / greeting от агента видно.
- Отчёт сравнения виден полностью.
- Сообщения user отображаются.
- После «скачать docx» — export-ack виден (хотя бы короткий текст).
- Кнопки появляются только после «скачать» / «вставить».

---

## Тест-план

### Подготовка

- Агент: `Tzr2xtBAyU0_jR1az_a8S` («R7: сравнение документов»).
- Документ R7 + шаблон `ТТ_десктоп.md`.
- Собранный плагин: `cd plugin/ladcraft-r7 && npm run build`.

### Сценарии

| # | Шаги | Ожидание |
|---|------|----------|
| 1 | Привет → шаблон → сравнение | Отчёт в чате, кнопок нет |
| 2 | «скачать» (без docx) | .md и .html под отчётом |
| 3 | «скачать docx» | Агент: ack «DOCX готов…» |
| 4 | Снова «скачать» или «скачать docx» под export | Кнопка **Скачать .docx** |
| 5 | Клик .docx | Файл скачивается, открывается в Word |
| 6 | Регрессия вставки | «вставить» → кнопки вставки из markdown отчёта |

### Проверка в DevTools (опционально)

В ответе `GET …/sessions/{id}/history` у export-сообщения:

```json
"tool_calls": [{
  "name": "r7_render_and_deliver_docx",
  "result": "{\"ok\":true,\"delivery\":\"inline_base64\",\"content_base64\":\"...\",\"fileName\":\"....docx\"}"
}]
```

---

## Сборка

```bash
cd plugin/ladcraft-r7
npm run typecheck   # исправить ошибки в изменённых файлах
npm run build       # dist/app.js
```

Деплой: обновить плагин в установке R7 Office (путь зависит от инсталляции).

---

## Вне scope этого handoff

- Правки `cases/compare-r7/skills/*` и агента — уже на prod.
- Починка Ladcraft VFS upload на backend.
- Клиентская генерация DOCX из CompareReport в плагине.

---

## Референс реализации (откачена пользователем)

Черновик тех же изменений был в коммите с DOCX fallback; пользователь **откатил плагин**. Можно смотреть diff того коммита в git по путям `plugin/ladcraft-r7/src/apply/*`, но **обязательно** прогнать smoke чата — не копировать слепо, если ломает отображение сообщений.

Ключевые пути эталона:

- `src/apply/docx-from-tools.ts` (новый)
- правки `download.ts`, `types.ts`, `resolve-actions.ts`, `user-action-intent.ts`, `insert.ts`
