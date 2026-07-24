# Проверенная доступность методов (Verified)

Платформа: **desktop и server** для VBA-набора сценариев (2026-04-18).  
Легенда: `supported` | `partial` | `unsupported` | `unknown`

---

## Paragraph

### supported
- `GetClassType()`, `GetStyle()`, `SetStyle()`, `GetParaPr()`, `GetNumbering()`
- `GetElementsCount()`, `GetElement()`, `AddElement()`, `RemoveElement()`, `RemoveAllElements()`, `GetText()`

### unsupported
- paragraph-level `GetColor()`, `GetFontFamily()`, `GetFontSize()`, `GetUnderline()`, `GetStrikeout()`
- `SetParaPr()` (не работает в текущей сборке)

---

## ParaPr

### supported
- `GetIndLeft/SetIndLeft`, `GetIndRight/SetIndRight`, `GetIndFirstLine/SetIndFirstLine`
- `GetJc/SetJc`, `GetSpacingBefore/SetSpacingBefore`, `GetSpacingAfter/SetSpacingAfter`
- `GetSpacingLineValue/SetSpacingLine`, `SetShd/GetShd`, `SetTabs()`, border setters

### partial (numbering)
- `SetNumPr()`, `SetBullet()`: вызов без ошибки, но **маркеры/нумерация в UI могут не появиться**
- Предпочтительно: форматирование списков из шаблона документа

### unsupported
- `Api.CreateParaPr()`, `FromJSON()` для paragraph props

---

## TextPr

### supported
- `SetShd/GetShd`, `SetBold/GetBold`, `SetItalic/GetItalic`, `SetVertAlign()`

### partial (setter без getter)
- `SetColor`, `SetHighlight`, `SetFill`, `SetTextFill`, `SetFontFamily`, `SetFontSize`, `SetUnderline`, `SetStrikeout`

---

## ContentControl

### supported
- Identity: `GetTag/SetTag`, `GetLabel/SetLabel`, `GetAlias/SetAlias`, `GetClassType()`
- Lock: `GetLock/SetLock`
- Content: `GetElementsCount`, `GetElement`, `RemoveElement`, `RemoveAllElements`, `Delete`, `AddText`, `Copy`
- Navigation: `GetParentParagraph`, `GetParentTable`, `GetParentTableCell`, `GetRange`
- Formatting: `SetTextPr()`
- Placeholder: `SetPlaceholderText`, `GetPlaceholderText`
- Other: `Search()`, `ToJSON()`

### unsupported
- `GetTitle()`, `GetText()` на control (читать через inner run)
- `GetDropdownListEntries`, `SetDropdownListEntries`, `ClearDropdownListEntries`
- `GetPlaceholderColor/SetPlaceholderColor`
- control-level `GetColor/SetColor`
- `GetContentControlByTitle()`, VBA `SelectContentControlsByTitle()`
- `GetContent()`

### partial / version-dependent
- `Select()` — может отсутствовать
- `AddElement()`, `Push()` — нестабильны
- `AddText()` на control — UI/readback может быть inconsistent

---

## Run (внутри ContentControl)

### supported
- `GetText()`, `AddText()`, `GetTextPr/SetTextPr()`, `SetFontSize()`, `SetBold()`, `SetItalic()`, `SetColor()`, `AddHyperlink()`, `AddDrawing()`

### unsupported
- `SetText()` на run
- `Run.GetBold()` — может отсутствовать на run в теле документа (SetBold работает)

---

## Cell (spreadsheet) — TABLES smoke

### supported (desktop + server)
- `Api.GetActiveSheet()`, `Api.AddSheet`, `Api.GetSheet`, `sheet.SetName`, `sheet.Delete`
- `GetCells` / `GetRange` — `SetValue` / `GetValue` (числа, текст, формулы через `SetValue("=...")`)
- `GetFormula` после записи формулы
- `SetBold`, `SetFillColor`, `SetBorders`, `Merge/UnMerge`
- `GetSelection`, `ForEach`, `Find/FindNext`, `Api.RecalculateAllFormulas`
- CSV → ячейки

### partial
- `Api.GetWorkbook()` → null
- `SetRowHeight/SetColumnWidth`, `GetHidden` по строке/столбцу

### unsupported / unknown
- `workbook.GetSheets()` при null GetWorkbook
- `SetFormula`, `SetFormulaArray` — методов нет

---

## Ключевые рецепты

**Читать значение из dropdown-контрола:**
```js
const element = control.GetElement(0);
const text = element && element.GetText ? element.GetText() : "";
```

**Заменить текст контрола:**
1. `RemoveAllElements()`
2. Создать run → `AddText(...)`
3. Добавить run в контейнер (или через `GetParentParagraph().AddText`)

**Идентификатор:** `GetTag()` — канонический ID шаблона.

**Копирование форматирования абзаца:** `newPara.SetStyle(parentPara.GetStyle())`

**Создание SDT:** `Api.CreateInlineLvlSdt()` / `Api.CreateBlockLvlSdt()` — supported; `Api.CreateText()` — нет.

**Нумерация списков:** `Paragraph.Copy()` + insert — наиболее надёжный путь в UI (desktop 2026-04-18).
