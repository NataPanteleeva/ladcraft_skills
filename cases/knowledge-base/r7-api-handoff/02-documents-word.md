# API документов (Word)

## Класс `Api` — методы (callCommand)

| Метод | Описание |
|-------|----------|
| `AcceptReviewChanges` | Принимает изменения рецензии |
| `AddAddinField` | Создаёт поле дополнения |
| `AddComment` | Добавляет комментарий |
| `AddContentControl` | Добавляет элемент управления содержимым |
| `AddContentControlCheckBox` | Content control — флажок |
| `AddContentControlDatePicker` | Content control — дата |
| `AddContentControlList` | Content control — список |
| `AddContentControlPicture` | Content control — изображение |
| `ChangeComment` | Изменяет комментарий |
| `ChangeOleObject` / `ChangeOleObjects` | Изменяет OLE |
| `GetAllAddinFields` | Все поля дополнений |
| `GetAllComments` | Все комментарии |
| `GetAllContentControls` | Все content controls |
| `GetAllOleObjects` | Все OLE-объекты |
| `GetCurrentContentControl` | ID выбранного content control |
| `GetCurrentContentControlPr` | Свойства текущего content control |
| `GetCurrentSentence` / `GetCurrentWord` | Текущее предложение / слово |
| `GetFields` | Все поля как текст |
| `GetFileHTML` | Содержимое файла в HTML |
| `InsertAndReplaceContentControls` | Вставка/замена content controls |
| `InsertOleObject` | Вставка OLE |
| `MoveCursorToContentControl` / `MoveCursorToEnd` / `MoveCursorToStart` | Перемещение курсора |
| `MoveToComment` / `MoveToNextReviewChange` | Навигация по рецензии |
| `OpenFile` | Открыть файл с полями |
| `RejectReviewChanges` | Отклонить изменения рецензии |
| `RemoveComments` | Удалить комментарии |
| `RemoveContentControl` / `RemoveContentControls` | Удалить content control (сохранить содержимое) |
| `RemoveFieldWrapper` | Удалить обёртку поля |
| `RemoveOleObject` / `RemoveOleObjects` | Удалить OLE |
| `RemoveSelectedContent` | Удалить выделение |
| `ReplaceCurrentSentence` / `ReplaceCurrentWord` | Заменить предложение / слово |
| `SearchAndReplace` / `SearchNext` | Поиск и замена |
| `SelectContentControl` / `SelectOleObject` | Выбор объектов |
| `SetDisplayModeInReview` | Режим отображения рецензирования |
| `SetEditingRestrictions` | Ограничения редактирования |
| `UpdateAddinFields` | Обновить поля дополнений |

## Document Builder — типичные классы

Через `Api.GetDocument()`:

| Класс | Возможности |
|-------|-------------|
| `ApiDocument` | `GetContent`, `GetText`, `ToMarkdown`, структура документа |
| `ApiParagraph` | `AddText`, `AddElement`, свойства абзаца |
| `ApiRun` | Текстовые фрагменты, `AddText` |
| `ApiTextPr` / `ApiParaPr` | Жирный, курсив, отступы |
| `ApiDocumentContent` | Обход элементов `GetElement` |

### Чтение для плагина (проверенные паттерны)

```js
// Весь текст
Api.GetDocument().GetContent().GetText()

// Таблицы как markdown
Api.GetDocument().ToMarkdown()
```

## Plugin API (executeMethod) — Word

| Метод | Назначение |
|-------|------------|
| `GetSelectedText` | Текст выделения |
| `GetSelectionType` | Тип выделения |
| `PasteHtml` | Вставка HTML в позицию курсора |
| `PasteText` | Вставка plain text |
| `AddComment` | Комментарий к документу |
| `SearchAndReplace` | Поиск-замена |
| `RemoveSelectedContent` | Удалить выделение |
| `AddContentControl` | Content control |
| `AddContextMenuItem` | Пункт контекстного меню |
| `StartAction` / `EndAction` | Блокировка UI |
| `CloseWindow` | Закрыть окно плагина |
| `GetMacros` / `SetMacros` | Макросы (GPT_Plugin; в EAI — убрано) |

## Матрица сценариев (Word)

| Сценарий | Механизм | Статус в типичном плагине |
|----------|----------|---------------------------|
| Прочитать весь текст | `callCommand` → `GetContent().GetText()` | supported |
| Прочитать таблицы как markdown | `ToMarkdown()` | supported |
| Прочитать выделение | `GetSelectedText` | supported |
| Вставить HTML | `PasteHtml` | supported (вставка, не replace) |
| Вставить plain text | `PasteText` | supported |
| Найти и заменить | `SearchAndReplace` | supported (EAI) |
| Удалить выделение | `RemoveSelectedContent` (**канон**; не `GetRangeBySelect().Delete`) | supported (EAI / Desktop probe) |
| Заменить выделение | `RemoveSelectedContent` + `PasteText` | supported (canon) |
| Добавить комментарий | `executeMethod("AddComment")` или `GetRangeBySelect().AddComment` при выделении; `content[0].GetRange().AddComment` всегда на 1-й абзац | supported (якорь зависит от вызова) |
| Список / правка комментариев | `GetAllComments`, `ChangeComment`, `RemoveComments`, `MoveToComment` | probe |
| Тип выделения | `GetSelectionType` | probe |
| Поиск без замены | `SearchNext` | probe |
| Слово / предложение у курсора | `GetCurrentWord` / `GetCurrentSentence` / `ReplaceCurrent*` | probe |
| HTML всего файла | `GetFileHTML` | probe |
| Режим рецензирования | `SetDisplayModeInReview` | probe (для видимости комментариев) |
| Перезаписать весь документ | `replace_body` (план) | planned |
| Content controls, OLE, формы | `Api.*` | API доступно, в плагине часто не подключено |

### Desktop probe notes (2026-07)

Пробник: `cases/plugin/r7-api-probe/`. Полная матрица: [`08-desktop-word-probe-results.md`](08-desktop-word-probe-results.md).

- **Канон удаления выделения:** `executeMethod("RemoveSelectedContent")`. `GetRangeBySelect().Delete` на Desktop **ломает документ** — не использовать.
- **Канон replace selection:** `RemoveSelectedContent` + `PasteText` / `PasteHtml`.
- **Комментарий к заголовку** — если вызывать `GetContent()[0].GetRange().AddComment` (legacy Ladcraft); для якоря к фразе — выделение + `executeMethod("AddComment")` или `GetRangeBySelect().AddComment`.
- **RemoveComments / ChangeComment / MoveToComment / SearchNext / GetFileHTML / ReplaceCurrent\* / SetDisplayModeInReview** — на прогнанной Desktop-сборке недоступны.
- **Форматирование (вставка/чтение):** см. [`09-desktop-word-formatting.md`](09-desktop-word-formatting.md).

## Создание SDT

- **supported:** `Api.CreateInlineLvlSdt()`, `Api.CreateBlockLvlSdt()`
- **unsupported:** `Api.CreateText()`
