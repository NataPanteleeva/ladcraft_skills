# R7 Cell — формат ячеек, выделение, шрифт, подчёркивание

Самодостаточный пакет для переноса в другой проект.  
Область: **редактор таблиц (Cell / spreadsheet)**, не таблица внутри Word.

Источники:
- smoke: `tables-smoke-04-format-merge`, `tables-smoke-05-selection-iterate-find` (desktop+server, 2026-04-18)
- VBA↔JS: `knowledge-base/cases/tables/case-tables-vba-js-snippets.md`
- примеры API: r7c-code `ApiRange`, `ApiFont`
- справочник: `docs/tables-macro-methods-handbook.md`, `r7-api-handoff/03-tables-cell.md`

**Легенда статусов**

| Статус | Значение |
|--------|----------|
| `supported` | Подтверждено smoke / кейсами проекта |
| `docs` | Есть в официальных примерах r7c; в smoke отдельно не гонялось |
| `partial` | Вызов ок, эффект/getter не строго подтверждён |
| `unknown` | Не проверено на целевой сборке |

---

## 1. Точка входа

```js
var sheet = Api.GetActiveSheet();
var cell  = sheet.GetCells(1, 1);      // row, col (1-based в типовых примерах)
var range = sheet.GetRange("A1:B10");  // адресный диапазон
```

| Метод | Статус | Назначение |
|-------|--------|------------|
| `Api.GetActiveSheet()` | `supported` | Активный лист |
| `sheet.GetRange(addr)` | `supported` | Диапазон по адресу |
| `sheet.GetCells(row, col)` | `supported` | Ячейка по координатам |
| `sheet.GetUsedRange()` | `docs` | Используемый диапазон |
| `Api.GetActiveCell` / `sheet.GetActiveCell` | `docs` | Активная ячейка |

---

## 1.1. Формат на всю таблицу / весь используемый диапазон

Отдельного метода вроде Excel `FormatAsTable` / `AutoFormat` в проверенных макросах проекта **нет**.  
Формат на «всю таблицу» делают так: взять диапазон целиком → вызвать сеттеры на этом `ApiRange` (они применяются ко всем ячейкам диапазона).

| Подход | API | Статус | Когда использовать |
|--------|-----|--------|-------------------|
| **Used range целиком** | `sheet.GetUsedRange()` + `SetBold` / `SetFontName` / `SetFillColor` / … | `docs` (+ чтение used range в плагинах `supported`) | «Вся заполненная область листа» |
| **Явный блок** | `sheet.GetRange("A1:F50").SetBold(true)` | `supported` (сеттеры на range) | Известны границы таблицы |
| **Выделение пользователя** | `range.Select()` → `Api.GetSelection().Set…` | `docs` / smoke selection | Пользователь сам выделил таблицу |
| **Поячеечно** | `GetUsedRange().ForEach(fn)` | `supported` | Условный формат (если value > N) |
| **Pivot Table style** | `ApiPivotTable.SetStyleName` / `SetTableStyleRowStripes` … | `docs` | Только сводные таблицы, не обычный диапазон |

**Пример: оформить весь used range** (паттерн из r7c `GetUsedRange`):

```js
var sheet = Api.GetActiveSheet();
var table = sheet.GetUsedRange(); // «вся таблица данных» на листе
table.SetFontName("Arial");
table.SetFontSize(11);
table.SetBold(false);
table.SetUnderline("none"); // проверить значение на сборке
table.SetFillColor(Api.CreateColorFromRGB(255, 213, 191));
table.SetBorders("Outline", "Thin", Api.CreateColorFromRGB(0, 0, 0)); // сторону/стиль сверить
```

**Пример: только «тело» таблицы по адресу + шапка отдельно:**

```js
var sheet = Api.GetActiveSheet();
var header = sheet.GetRange("A1:D1");
header.SetBold(true);
header.SetFillColor(240, 240, 240);

var body = sheet.GetRange("A2:D100");
body.SetFontName("Arial");
body.SetFontSize(10);
```

**Пример: выделить used range и применить формат к выделению:**

```js
var used = Api.GetActiveSheet().GetUsedRange();
used.Select();
var sel = Api.GetSelection();
sel.SetBold(true);
sel.SetUnderline("single");
```

> Итог: «формат всей таблицы» = **операция над диапазоном** (`GetUsedRange` / `GetRange` / `GetSelection`), а не отдельный Table-style API для обычных ячеек.

---

## 2. Выделение (selection)

| Метод / свойство | Статус | Описание |
|------------------|--------|----------|
| `range.Select()` | `docs` | Выделить диапазон |
| `Api.GetSelection()` | `supported` | Текущее выделение (smoke-05) |
| `sheet.GetSelection()` | `supported` | То же на листе (если есть) |
| `Api.Selection` (свойство) | `docs` | Алиас выделения |
| `range.Activate()` | `docs` | Активировать диапазон |
| `executeMethod("GetSelectionType")` | `docs` | Тип выделения из плагина |
| `executeMethod("RemoveSelectedContent")` | `docs` | Удалить содержимое выделения (плагин) |

### Реализация: выделить и записать в выделение

```js
var sheet = Api.GetActiveSheet();
var range = sheet.GetRange("A1:C1");
range.SetValue("1");
range.Select();
Api.GetSelection().SetValue("selected");
```

### Реализация: взять выделение и отформатировать

```js
var sel = Api.GetSelection(); // или sheet.GetSelection()
if (sel) {
  sel.SetBold(true);
  sel.SetUnderline("single");
  sel.SetFontName("Arial");
}
```

### Реализация: обход выделения / диапазона

```js
var rng = Api.GetActiveSheet().GetRange("A1:B10");
rng.ForEach(function (cell) {
  cell.SetBold(true);
});
```

Статус `ForEach`: `supported` (smoke-05).

### VBA → R7

| VBA | R7 |
|-----|-----|
| `Range("A1").Select` | `GetRange("A1").Select()` |
| `Selection.Value = ...` | `Api.GetSelection().SetValue(...)` |
| `Selection.Font.Bold = True` | `Api.GetSelection().SetBold(true)` |

---

## 3. Шрифт в ячейке / диапазоне

Два пути:

1. **Прямые сеттеры на `ApiRange`** (предпочтительны для целой ячейки/диапазона).
2. **`ApiFont` через `GetCharacters(...).GetFont()`** — для части текста внутри ячейки.

### 3.1. Прямые методы `ApiRange` (шрифт)

| Метод | Статус | Пример аргумента |
|-------|--------|------------------|
| `SetBold(bool)` | `supported` | `true` |
| `SetItalic(bool)` | `docs` | `true` |
| `SetFontName(name)` | `docs` | `"Arial"` |
| `SetFontSize(size)` | `docs` | `20` |
| `SetFontColor(color)` | `docs` / кейс | `Api.CreateColorFromRGB(255, 111, 61)` |
| `SetUnderline(style)` | `docs` | `"single"` (см. §4) |
| `SetStrikeout(bool)` | `docs` | `true` |
| `GetFont()` | `docs` | объект шрифта диапазона (если есть) |
| `SetFont(...)` | `docs` | альтернативный путь из матрицы плагина |

В smoke-04 подтверждены: **`SetBold`**, **`SetFillColor`** (заливка, не шрифт).  
`SetFontName` / `SetFontSize` / `SetFontColor` / `SetUnderline` — в примерах r7c и VBA-кейсах; на целевой сборке стоит smoke-проверить.

### Пример: шрифт на диапазоне

```js
var sheet = Api.GetActiveSheet();
sheet.GetRange("A2").SetValue("Заголовок");
var range = sheet.GetRange("A1:D5");
range.SetFontName("Arial");
range.SetFontSize(14);
range.SetBold(true);
sheet.GetRange("A2").SetFontColor(Api.CreateColorFromRGB(255, 111, 61));
```

### Пример: жирный (smoke / кейс)

```js
Api.GetActiveSheet().GetRange("A2").SetBold(true);
// или
Api.GetActiveSheet().GetCells(2, 1).SetBold(true);
```

### VBA → R7 (шрифт)

| VBA | R7 |
|-----|-----|
| `Range("A2").Font.Bold = True` | `GetRange("A2").SetBold(true)` |
| `Range("B4").Font.Color = RGB(...)` | `SetFontColor(Api.CreateColorFromRGB(r,g,b))` |
| `Range("A1").Font.Name = "Arial"` | `SetFontName("Arial")` |
| `Range("A1").Font.Size = 12` | `SetFontSize(12)` |
| `Range("A1").Font.Italic = True` | `SetItalic(true)` |

### 3.2. Часть текста в ячейке — `GetCharacters` + `ApiFont`

```js
var range = Api.GetActiveSheet().GetRange("B1");
range.SetValue("This is just a sample text.");
var characters = range.GetCharacters(9, 4); // start, length
var font = characters.GetFont();
font.SetBold(true);
font.SetUnderline("xlUnderlineStyleSingle");
font.SetName("Arial");
font.SetSize(18);
```

### Методы `ApiFont` (docs / примеры)

| Метод | Описание |
|-------|----------|
| `SetBold` / `GetBold` | Жирный |
| `SetItalic` / `GetItalic` | Курсив |
| `SetName` / `GetName` | Имя шрифта |
| `SetSize` / `GetSize` | Размер |
| `SetColor` / `GetColor` | Цвет |
| `SetUnderline` / `GetUnderline` | Подчёркивание |
| `SetStrikethrough` / `GetStrikethrough` | Зачёркивание |
| `SetSuperscript` / `GetSuperscript` | Надстрочный |
| `SetSubscript` / `GetSubscript` | Подстрочный |
| `GetParent` | Родительский объект |

Статус: `docs` (не в TABLES smoke-04; проверять на хосте).

---

## 4. Подчёркивание

### На всём диапазоне / ячейке

```js
var sheet = Api.GetActiveSheet();
sheet.GetRange("A2").SetValue("Текст с подчёркиванием");
sheet.GetRange("A2").SetUnderline("single");
```

| Значение (из примеров) | Где |
|------------------------|-----|
| `"single"` | `ApiRange.SetUnderline` (r7c) |
| `"xlUnderlineStyleSingle"` | `ApiFont.SetUnderline` через Characters |

> Точный enum (`single` / `double` / `none` / xl-стили) зависит от сборки — при портировании проверить оба варианта.

### На части текста

```js
var range = Api.GetActiveSheet().GetRange("B1");
range.SetValue("This is just a sample text.");
var font = range.GetCharacters(9, 4).GetFont();
font.SetUnderline("xlUnderlineStyleSingle");
```

### Снять подчёркивание (типовой подход)

```js
// если API принимает none / false — уточнить на сборке
range.SetUnderline("none"); // проверить наличие
```

Статус `SetUnderline`: `docs` (пример r7c есть; в TABLES smoke отдельной строки нет).

---

## 5. Формат ячейки / диапазона (не шрифт)

### 5.1. Заливка, границы, merge — подтверждено smoke

| Метод | Статус | Пример |
|-------|--------|--------|
| `SetFillColor(r,g,b)` или `SetFillColor(Api.CreateColorFromRGB(...))` | `supported` | `(240, 240, 240)` |
| `GetFillColor()` | `docs` | чтение заливки |
| `SetBorders(...)` | `supported` | см. ниже |
| `Merge()` / `UnMerge()` | `supported` | на `GetRange("A1:C1")` |
| `Merge(true)` | `docs` / кейс | флаг merge — сверить версию |

**Заливка + жирный (smoke-04):**

```js
var cell = Api.GetActiveSheet().GetCells(110, 1);
cell.SetBold(true);
cell.SetFillColor(240, 240, 240);
```

**Заливка через цвет (кейс VBA):**

```js
range.SetFillColor(Api.CreateColorFromRGB(255, 111, 61));
```

**Границы (пример r7c + smoke):**

```js
// Полный вид из примеров:
sheet.GetRange("A2").SetBorders("Bottom", "Thick", Api.CreateColorFromRGB(255, 111, 61));

// В smoke иногда вызывали SetBorders() без аргументов — наличие метода подтверждено;
// для продакшена используйте форму со стороной/типом/цветом.
```

**Объединение:**

```js
var rng = Api.GetActiveSheet().GetRange("A1:B3");
rng.Merge(true);   // или Merge() — уточнить на сборке
rng.UnMerge();
```

### 5.2. Выравнивание, перенос, числовой формат

| Метод | Статус | Описание |
|-------|--------|----------|
| `SetAlignHorizontal(...)` | `docs` | Горизонтальное выравнивание |
| `SetAlignVertical(...)` | `docs` | Вертикальное |
| `SetHorizontalAlignment` / `Get…` | `docs` | Альтернативные имена в матрице |
| `SetWrap` / `GetWrapText` | `docs` | Перенос текста |
| `SetNumberFormat(fmt)` / `GetNumberFormat` | `docs` | Числовой формат |
| `AutoFit()` | `docs` | Подгон ширины (часто после SetValue в плагине) |
| `Clear` / `ClearContents` / `ClearFormats` | `docs` | Очистка значений / форматов |

```js
var range = Api.GetActiveSheet().GetRange("A1");
range.SetAlignHorizontal("center"); // проверить допустимые строки на сборке
range.SetNumberFormat("0.00");
```

### 5.3. Размеры строк/столбцов, скрытие

| Метод | Статус | Примечание |
|-------|--------|------------|
| `sheet.SetRowHeight(row, h)` | `partial` | Вызов ok в smoke |
| `sheet.SetColumnWidth(col, w)` | `partial` | Индекс 0/1-based сверить |
| `range.SetRowHeight` / `SetColumnWidth` | `docs` | На диапазоне |
| `range.GetHidden()` | `partial` | Для `"1:1"` / `"A:A"` |
| `AutoFit` | `docs` | |

```js
Api.GetActiveSheet().SetColumnWidth(0, 50); // как в примере SetBorders
Api.GetActiveSheet().SetRowHeight(5, 18);
```

### 5.4. Очистка формата

```js
range.ClearFormats(); // только оформление
range.ClearContents(); // только значения
range.Clear();         // шире — проверить семантику на хосте
```

---

## 6. Возможности реализации (чеклист сценариев)

| # | Задача | Рекомендуемый путь | Статус готовности |
|---|--------|--------------------|-------------------|
| 1 | Выделить диапазон | `GetRange(...).Select()` | `docs` |
| 2 | Форматировать текущее выделение | `Api.GetSelection().SetBold/SetUnderline/SetFontName` | `supported` + `docs` |
| 3 | Записать в выделение | `GetSelection().SetValue(...)` | `docs` / кейс |
| 4 | Жирный на ячейке | `SetBold(true)` | `supported` |
| 5 | Имя/размер/цвет шрифта | `SetFontName` / `SetFontSize` / `SetFontColor` | `docs` |
| 6 | Подчеркнуть всю ячейку | `SetUnderline("single")` | `docs` |
| 7 | Подчеркнуть часть текста | `GetCharacters(i,n).GetFont().SetUnderline(...)` | `docs` |
| 8 | Заливка ячейки | `SetFillColor` | `supported` |
| 9 | Границы | `SetBorders(side, style, color)` | `supported` (наличие) |
| 10 | Merge/UnMerge | `Merge` / `UnMerge` | `supported` |
| 11 | Массово по диапазону | `ForEach` + сеттеры формата | `supported` |
| 11a | Формат всей таблицы / used range | `GetUsedRange().SetBold/SetFont…` (см. §1.1) | `docs` |
| 12 | Условная заливка (значение > N) | цикл / ForEach + `SetFillColor` | `docs` / кейс |
| 13 | Из плагина | `callCommand` → те же `Api.*` | `docs` |
| 14 | EAI `r7.task` cell_paste | только значения + AutoFit | **не** формат шрифта |

> В чат-плагинах (GPT/EAI) обычно пишут **значения** ячеек (`SetValue`), а не полный формат. Формат шрифта/подчёркивания — через макрос или `callCommand` с явными сеттерами.

---

## 7. Готовые мини-шаблоны

### Шаблон A — «оформить шапку таблицы»

```js
(function () {
  var sheet = Api.GetActiveSheet();
  var header = sheet.GetRange("A1:D1");
  header.SetBold(true);
  header.SetFillColor(240, 240, 240);
  header.SetFontName("Arial");
  header.SetFontSize(12);
  header.SetUnderline("single"); // при необходимости
  header.SetAlignHorizontal("center");
})();
```

### Шаблон B — «формат выбранных ячеек»

```js
(function () {
  var sel = Api.GetSelection();
  if (!sel) return;
  sel.SetFontName("Times New Roman");
  sel.SetFontSize(11);
  sel.SetBold(false);
  sel.SetItalic(false);
  sel.SetUnderline("single");
  sel.SetFontColor(Api.CreateColorFromRGB(0, 0, 0));
})();
```

### Шаблон C — «подчеркнуть фрагмент в ячейке»

```js
(function () {
  var cell = Api.GetActiveSheet().GetRange("A1");
  cell.SetValue("Договор № 123 от 01.01.2026");
  // пример: подчеркнуть "123" — подобрать start/length под реальный текст
  var font = cell.GetCharacters(10, 3).GetFont();
  font.SetUnderline("xlUnderlineStyleSingle");
  font.SetBold(true);
})();
```

### Шаблон D — «обход и условный формат»

```js
(function () {
  var rng = Api.GetActiveSheet().GetRange("B2:B100");
  rng.ForEach(function (cell) {
    var v = cell.GetValue();
    var n = typeof v === "number" ? v : parseFloat(v);
    if (!isNaN(n) && n > 5) {
      cell.SetFillColor(Api.CreateColorFromRGB(255, 200, 200));
      cell.SetBold(true);
    }
  });
})();
```

---

## 8. Ограничения и заметки

1. **`SetFormula` на ячейке** в проверенной сборке может отсутствовать — формулы через `SetValue("=...")`.
2. **`Api.GetWorkbook()`** часто `null` — не опираться на объект книги для формата.
3. Индекс **столбца** в `SetColumnWidth` в примерах бывает **0-based** — сверить на хосте.
4. Плагин **не заменяет** макросный формат: `cell_paste` ≠ `SetUnderline`/`SetFontName`.
5. Перед `GetValue` по формуле нужен пересчёт (`RecalculateAllFormulas` / Calculate).
6. Word-таблица в документе ≠ Cell API — для Word другие классы (`CreateTable` и т.д.).

---

## 9. Источники в исходном репозитории

- `validation/macros/tables/tables-smoke-04-format-merge.js`
- `validation/macros/tables/tables-smoke-05-selection-iterate-find.js`
- `docs/tables-macro-methods-handbook.md`
- `knowledge-base/cases/tables/case-tables-vba-js-snippets.md`
- `knowledge-base/methods/tables-methods.md`
- `plugins-inventory/raw/r7c-code/.../examples/ApiRange/` (`SetBold`, `SetUnderline`, `SetFontName`, `SetFontSize`, `SetFontColor`, `Select`, `ForEach`, `SetBorders`, `SetFillColor`, `Merge`, …)
- `plugins-inventory/raw/r7c-code/.../examples/ApiFont/`

---

*Файл: `knowledge-base/r7-api-handoff/r7-cell-format-selection-font.md`*
