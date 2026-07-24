# Desktop Word API — результаты прогона (R7 API Probe)

**Платформа:** R7 Office **Desktop** (Word), плагин [`cases/plugin/r7-api-probe/`](../../plugin/r7-api-probe/) v0.2.0  
**Дата прогона:** 2026-07-14  
**Документ теста:** сублицензионный договор (~95 абзацев), локальный файл (не Р7-Диск)  
**Источник списка методов:** [`02-documents-word.md`](02-documents-word.md)

Этот файл — **фактическая матрица доступности** методов на Desktop для плагина и навыков Ladcraft.  
Справочник объявлений API — в `02-documents-word.md`; статусы здесь важнее для интеграции «открытый документ».

---

## Краткий вердикт

| Область | На Desktop |
|---------|------------|
| Чтение (GetText, ToMarkdown, выделение) | Работает |
| Вставка PasteHtml / PasteText | Работает |
| SearchAndReplace | Работает |
| Удаление / замена **выделения** | Только через `RemoveSelectedContent` (+ paste) |
| Комментарий к **выделению** | Работает (`executeMethod` / `GetRangeBySelect.AddComment`) |
| Комментарий к **1-му абзацу** (legacy Ladcraft) | Работает, всегда заголовок |
| Управление комментариями (Change / Remove / Move) | **API недоступен** в probe |
| SearchNext, GetFileHTML, ReplaceCurrent*, SetDisplayModeInReview | **Недоступны** |
| `GetRangeBySelect().Delete` | **Опасно** — ошибка документа |

Для `r7.task` на Desktop опираться на: paste / paste_text / search_replace / **RemoveSelectedContent** / replace = RemoveSelectedContent+paste / add_comment **по выделению**.

---

## Архитектура применения (напоминание)

```
Навык Ladcraft  →  r7.task  →  плагин  →  Asc.plugin (executeMethod | callCommand)  →  открытый Word
```

Навык **не** пишет в документ сам. Snapshot VFS — только для чтения.

---

## Матрица: проверено на Desktop

Легенда: `ok` | `fail` | `dangerous` | `partial`

### Чтение и выделение

| Метод | Результат | Примечание |
|-------|-----------|------------|
| `GetContent` / GetText | ok | ~95 paras |
| `ToMarkdown` | ok | |
| `GetSelectedText` | ok | |
| `GetSelectionType` | ok | например `"text"` |
| `GetFileHTML` | fail | `no-GetFileHTML` |
| `GetCurrentWord` / `GetCurrentSentence` | fail | N/A на этой сборке |

### Курсор и UI

| Метод | Результат | Примечание |
|-------|-----------|------------|
| `MoveCursorToEnd` / `MoveCursorToStart` | ok | |
| `StartAction` / `EndAction` | ok | |
| `SetDisplayModeInReview` | fail | `no-SetDisplayModeInReview` |

### Вставка и поиск/замена

| Метод | Результат | Примечание |
|-------|-----------|------------|
| `PasteHtml` | ok | Вставка `PROBE_MARK` в конец |
| `PasteText` | ok | |
| `SearchAndReplace` | ok | При пустом маркере бывает `count=0` (нет совпадений) |
| `SearchNext` | fail | метод недоступен |

### Выделение: delete / replace

| Метод / паттерн | Результат | Примечание |
|-----------------|-----------|------------|
| **`executeMethod("RemoveSelectedContent")`** | **ok** | **Канон удаления выделения** |
| **RemoveSelectedContent + PasteText** | **ok** | **Канон replace selection** |
| `GetRangeBySelect().Delete` | **dangerous** | Лог может быть OK, документ ломается — **не использовать** |
| Replace через Delete + PasteText | dangerous | Наследует риск Delete |

### Комментарии

| Метод / паттерн | Результат | Примечание |
|-----------------|-----------|------------|
| `content[0].GetRange().AddComment` | ok | Всегда якорь на **заголовок** (1-й абзац); выделение игнорируется |
| `executeMethod("AddComment", [{Text, UserName, UserId}])` при выделении | ok | Якорь к выделенной фразе |
| `GetRangeBySelect().AddComment` | ok | Якорь к выделению |
| `GetAllComments` | partial | `count` есть; поля id/text/quote в sample пустые (другая форма объектов) |
| `ChangeComment` | fail | `no-ChangeComment-api` |
| `MoveToComment` | fail | `no-MoveToComment-api` |
| `RemoveComments` | fail | `no-RemoveComments-api` — **программно комментарий не убрать** этим API |

Визуально: панель «Комментарии»; при need visibility — UI режима рецензирования (API SetDisplayMode недоступен).

### Точечная замена у курсора

| Метод | Результат |
|-------|-----------|
| `ReplaceCurrentWord` | fail — нет API |
| `ReplaceCurrentSentence` | fail — нет API |

Альтернатива на Desktop: `SearchAndReplace` или replace selection (RemoveSelectedContent + paste).

---

## Каноны для Ladcraft / плагина

### 1. Удалить выделение

```js
Asc.plugin.executeMethod("RemoveSelectedContent", [], cb);
```

**Запрещено:** `Api.GetDocument().GetRangeBySelect().Delete()`.

### 2. Заменить выделение

```js
// 1) RemoveSelectedContent
// 2) PasteText или PasteHtml
```

### 3. Комментарий

| Цель | Как |
|------|-----|
| К выделенной фразе (proofread) | `executeMethod("AddComment", …)` или `GetRangeBySelect().AddComment` |
| Legacy (как старый Ladcraft) | `GetContent()[0].GetRange().AddComment` → всегда заголовок |

### 4. Массовые текстовые правки

`SearchAndReplace` через `callCommand` + `Asc.scope` (как в apply-слое).

### 5. Удаление комментариев

На этой Desktop-сборке **нет** рабочего `RemoveComments` / `ChangeComment` / `MoveToComment` из плагина. Удаление — только руками в UI редактора (пока не найден другой API).

---

## Что сознательно не прогонялось

Content controls, OLE, add-in fields, Accept/RejectReviewChanges, OpenFile, SetEditingRestrictions, macros — см. `02-documents-word.md`. Для текущего `r7_doc_handler` не блокер.

Cell — отдельные пробы в том же плагине (`GetWorkbook` часто null, SetValue / used range работают); детали при необходимости дополнять отдельно.

---

## Связанные артефакты

| Путь | Назначение |
|------|------------|
| [`cases/plugin/r7-api-probe/`](../../plugin/r7-api-probe/) | Живой пробник Desktop |
| [`02-documents-word.md`](02-documents-word.md) | Каталог методов Word |
| [`07-plugin-integration.md`](07-plugin-integration.md) | Плагин + `r7.task` |
| [`05-method-availability.md`](05-method-availability.md) | VBA/общий availability (не заменяет этот Desktop-прогон) |
| [`09-desktop-word-formatting.md`](09-desktop-word-formatting.md) | Формат: TextPr/Run setters OK; чтение char-format нет; InsertParagraph parent FAIL |
| `08-desktop-word-probe-results.docx` | Тот же summary для передачи коллегам |

---

## Дополнение: форматирование (2026-07-15)

Вынесено в [`09-desktop-word-formatting.md`](09-desktop-word-formatting.md). Кратко:

- **Задать** FontSize / FontFamily / Color / Bold при вставке — **да** (`CreateTextPr` или setters на Run).  
- **Считать** char-format с выделения — **нет** (`GetBold` на run отсутствует). ParaPr getters — да.  
- `InsertParagraph` + copy numbering/style — пока **без parent** у курсора.  
- `doc.InsertContent` только через Run+AddElement.

Пробник: `cases/plugin/r7-api-probe-text/`.

---

## Лог (фрагмент прогона 2026-07-14)

Ключевые строки:

- GetText / ToMarkdown / GetSelectedText / GetSelectionType — OK  
- PasteHtml / PasteText / SearchAndReplace — OK  
- AddComment first para / EM / on selection — OK  
- GetAllComments — OK (count), sample id/text пустые  
- ChangeComment / MoveToComment / RemoveComments — FAIL (нет API)  
- SearchNext / GetFileHTML / SetDisplayModeInReview / ReplaceCurrent* — FAIL  
- RemoveSelectedContent / Replace sel (canon) — OK  
- Delete (legacy) — лог OK, **на практике ломает документ**
