# API таблиц (Cell / Spreadsheet)

## Класс `Api` (callCommand)

**Свойства:** `ActiveSheet`, `ActiveCell`, `Selection`

| Метод | Описание |
|-------|----------|
| `AddComment` | Комментарий к диапазону |
| `AddContentControl*` | Content controls (checkbox, date, list, picture) |
| `AddDefName` | Именованный диапазон |
| `AddProtectedRange` | Защищённый диапазон |
| `AddSheet` | Новый лист |
| `Calculate` | Пересчёт формул |
| `GetAllComments` / `GetAllContentControls` / `GetAllDefNames` | Коллекции |
| `GetAllOleObjects` / `GetAllProtectedRanges` / `GetAllSheets` | Коллекции |
| `GetActiveSheet` / `GetActiveCell` | Активные объекты |
| `GetCommentById` / `GetContentControlById` / `GetDefName` | По ID/имени |
| `GetFileHTML` | HTML книги |
| `GetRange` / `GetSelection` / `GetSheet` | Доступ к диапазонам и листам |
| `InsertAndReplaceContentControls` / `InsertOleObject` | Вставка |
| `MoveToComment` | К комментарию |
| `OpenFile` | Открыть файл |
| `RemoveComments` / `RemoveContentControl*` / `RemoveDefName` | Удаление |
| `RemoveOleObject*` / `RemoveProtectedRange` / `RemoveSelectedContent` | Удаление |
| `ReplaceCurrentSentence` / `ReplaceCurrentWord` | Замена текста |
| `SearchAndReplace` / `SearchNext` | Поиск |
| `SelectContentControl` / `SelectOleObject` | Выбор |
| `SetEditingRestrictions` | Ограничения редактирования |

## Класс `ApiRange`

**Свойства:** `Address`, `Column`, `Columns`, `Count`, `Font`, `Formula`, `Height`, `HorizontalAlignment`, `Interior`, `Left`, `NumberFormat`, `Row`, `Rows`, `Text`, `Top`, `Value`, `VerticalAlignment`, `Width`, `WrapText`

| Метод | Описание |
|-------|----------|
| `Activate` | Активировать диапазон |
| `AddComment` | Комментарий |
| `AutoFilter` / `AutoFit` | Фильтр / подгон размера |
| `Clear` / `ClearAll` / `ClearComments` / `ClearContents` / `ClearFormats` | Очистка |
| `Copy` / `Cut` / `Paste` | Буфер обмена |
| `Delete` / `Insert` | Удалить / вставить ячейки |
| `Fill` / `Find` / `Replace` | Заполнение / поиск |
| `GetAddress` / `GetCell` / `GetCells` / `GetColumn` / `GetColumns` | Чтение структуры |
| `GetFont` / `GetFormula` / `GetValue` / `GetText` | Чтение свойств |
| `Merge` / `Unmerge` | Объединение |
| `Select` | Выделить |
| `SetFont` / `SetFormula` / `SetValue` / `SetNumberFormat` | Запись |

## Класс `ApiWorksheet`

**Свойства:** `Index`, `Name`, `Visible`

| Метод | Описание |
|-------|----------|
| `Activate` | Активировать лист |
| `AddChart` / `AddComment` / `AddImage` / `AddShape` | Объекты |
| `AutoFilter` | Автофильтр |
| `Delete` / `Move` / `Rename` / `SetName` | Управление листом |
| `GetActiveCell` / `GetCells` / `GetRange` / `GetUsedRange` | Доступ к данным |
| `Protect` / `Unprotect` | Защита листа |
| `SetColumnWidth` / `SetRowHeight` | Размеры |

## Паттерн записи из плагина

```js
Asc.plugin.callCommand(() => {
  const sheet = Api.GetActiveSheet();
  sheet.GetRange("A1").SetValue("...");
  sheet.GetRange("A1").AutoFit();
});
```

Чтение used range:

```js
Api.GetActiveSheet().GetUsedRange().GetValue()
```

Запись по карте адресов (`cell_paste`):

```json
{ "A1": "текст", "B2": "123" }
```

## Smoke-результаты (desktop + server, 2026-04-18)

### supported

- `Api.GetActiveSheet()` — активный лист доступен
- `Api.AddSheet(name)`, `Api.GetSheet(name)` — создание и получение листа
- `sheet.SetName(newName)` / `Rename` — переименование
- `sheet.Delete()` — удаление листа
- `sheet.GetCells(row, col)` — `SetValue` / `GetValue`
- `sheet.GetRange("A1")` — `SetValue` / `GetValue` (в т.ч. формула `=SUM(...)`)
- `GetFormula` после записи формулы через `SetValue`
- `SetBold`, `SetFillColor`, `SetBorders`, `Merge` / `UnMerge`
- `GetSelection`, `ForEach`, `Find` / `FindNext`
- `Api.RecalculateAllFormulas`
- Разбор CSV в ячейки (`GetCells` + `SetValue`, разделитель `;` или `,`)

### partial

- `Api.GetWorkbook()` — возвращает **null** при рабочих `AddSheet` / `GetSheet`
- `SetRowHeight` / `SetColumnWidth` — вызов ok, эффект не строго проверен
- `GetRange("1:1")` / `GetRange("A:A")` + `GetHidden` — partial

### unsupported / unknown

- `workbook.GetSheets()` — недоступен, пока `GetWorkbook` не даёт объект
- **`SetFormula`** на ячейке — метода нет (используйте `SetValue("=...")`)
- **`SetFormulaArray`** — метода нет
- `$.ajax(file://)` к локальному файлу — зависит от политики хоста

## Практические рекомендации

1. **Не опираться на `GetWorkbook`** — использовать `Api.AddSheet` / `Api.GetSheet`.
2. Формулы: `SetValue("=SUM(B1:B10)")` + пересчёт перед `GetValue`.
3. Импорт CSV: `AddSheet` → разбор строк → `GetCells(r,c).SetValue` (без clipboard).
4. Лимит контекста в чат-плагинах: ~1000 непустых ячеек (used range).
5. **`GetRow` / `GetCol` в R7 — 1-based** (A1 → row=1, col=1). Не трактовать как 0-based при сборке адреса.
6. **Viewport после массового `SetValue`** — см. канон ниже.

## Viewport после `SetValue` (канон, ladcraft-r7_new, 2026-07-21)

Проблема: после `SetValue` сетка часто не перерисовывается, пока пользователь не проскроллит или не сменит лист.

| Не делать | Почему |
|-----------|--------|
| Только `range.Select()` в том же `callCommand`, что запись | `Select` **не скроллит** вид; внешних функций плагина в sandbox `callCommand` нет |
| Ждать отдельный Scroll API плагина | Метода нет |

**Рабочее решение:**

1. Запись в первом `callCommand`.
2. Во втором `callCommand` (inline): `AutoFit` → `GetFreezePanes().Unfreeze()` → `Select("A100")` → `Select(home)` → `RecalculateAllFormulas` (если есть).

Реализация: `cases/plugin/ladcraft-r7_new/src/apply/editor-methods.ts` (`nudgeCellViewportAfterWrite`). Описание для табличных агентов: `cases/plugin/ladcraft-r7_new/docs/TABLE-AGENTS-PLUGIN.md`.

## VBA → R7 маппинг (таблицы)

| VBA-задача | R7-путь | Уверенность |
|------------|---------|-------------|
| Итерация по диапазону | cell/range loop | high |
| Массовое форматирование | style/set format methods | medium |
| Удалить все листы кроме одного | `Api.GetSheets()` + reverse `Delete()` | high |
| Дедупликация в новый лист | read column → `Set` → write | high |
| Chunk copy столбцов | `GetValue()` + chunked `SetValue()` | high |
| Запись по координатам | `GetRange("C4").SetValue` / `GetCells(r,c)` | high |
| Merge / unmerge | `Merge(true)` / `UnMerge()` | medium |
| Импорт CSV/TXT | `$.ajax(file://)` → split → `SetValue` | high (desktop) |
| Загрузка текста в A1 | `GetCells(1,1).SetValue(text)` | high |
