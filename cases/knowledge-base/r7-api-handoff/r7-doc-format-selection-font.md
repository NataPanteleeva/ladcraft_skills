# R7 Word — формат документа, выделение, шрифт, подчёркивание

Самодостаточный пакет для переноса в другой проект.  
Область: **редактор документов (Word)**, не Cell.

Источники:
- smoke: `doc-smoke-01` … `05`, `doc-smoke-02-doc-tables` (desktop+server, 2026-04-18)
- матрица: `knowledge-base/methods/api-method-availability.md`
- обходы: `knowledge-base/methods/quick-workarounds.md`
- примеры: r7c-code `ApiRun`, `ApiTextPr`, `ApiParagraph`, `ApiParaPr`
- родственный Cell-файл: `r7-cell-format-selection-font.md`

**Легенда статусов**

| Статус | Значение |
|--------|----------|
| `supported` | Подтверждено smoke / матрицей |
| `docs` | Есть в примерах r7c; в smoke отдельно не гонялось |
| `partial` | Setter без getter / API ок, UI нестабилен |
| `unsupported` | Нет или не работает в проверках |

---

## 1. Точка входа

```js
var doc  = Api.GetDocument();
var para = Api.CreateParagraph();
var run  = Api.CreateRun();
var tp   = Api.CreateTextPr();
```

| Метод | Статус | Назначение |
|-------|--------|------------|
| `Api.GetDocument()` | `supported` | Активный документ |
| `Api.CreateParagraph()` | `supported` | Новый абзац |
| `Api.CreateRun()` | `supported` | Текстовый фрагмент |
| `Api.CreateTextPr()` | `supported` | Свойства символа |
| `doc.InsertContent([…])` | `supported` | Вставка в документ |
| `doc.GetElementsCount` / `GetElement(i)` | `supported` | Обход элементов |
| `Api.CreateParaPr()` | `unsupported` | Брать `paragraph.GetParaPr()` |

---

## 1.1. Формат на весь документ / большой блок

Отдельного «применить стиль ко всему файлу одним кликом API» в проверенных макросах **нет** (нет аналога «Select All → Font» одним высокоуровневым методом в smoke).

Практические пути:

| Подход | Как | Статус |
|--------|-----|--------|
| **Обход всех абзацев** | цикл `GetElement` → run/TextPr | `supported` (структура) |
| **Стиль абзаца** | `para.SetStyle(style)` от эталона | `supported` |
| **Вставка уже оформленного HTML** | `PasteHtml` (плагин) | `docs` — формат в HTML |
| **replace_body + HTML** | очистка тела + `PasteHtml` | planned в плагине |
| **Выделение → формат** | `GetSelectedText` + replace/paste; в макросе — правка run в выделении | `docs` / partial |

**Пример: пройти весь документ и сделать текст жирным (через runs):**

```js
var doc = Api.GetDocument();
var n = doc.GetElementsCount();
for (var i = 0; i < n; i++) {
  var el = doc.GetElement(i);
  if (!el || !el.GetElementsCount) continue;
  var m = el.GetElementsCount();
  for (var j = 0; j < m; j++) {
    var run = el.GetElement(j);
    if (run && run.SetBold) run.SetBold(true);
  }
}
```

**Пример: единый стиль абзацев от образца:**

```js
var style = sourcePara.GetStyle();
var newPara = Api.CreateParagraph();
newPara.AddText("новый абзац");
newPara.SetStyle(style);
Api.GetDocument().InsertContent([newPara]);
```

> Для «переоформить весь документ» в плагине чаще надёжнее сгенерировать HTML/markdown и вставить (`PasteHtml` / `replace_body`), чем точечно трогать каждый run.

---

## 2. Выделение (selection)

| Метод / слой | Статус | Описание |
|--------------|--------|----------|
| `executeMethod("GetSelectedText")` | `docs` | Текст выделения (плагин) |
| `executeMethod("GetSelectionType")` | `docs` | Тип выделения |
| `executeMethod("RemoveSelectedContent")` | `docs` | Удалить выделение |
| `executeMethod("PasteHtml" / "PasteText")` | `docs` | Вставка в позицию курсора (**не** smart-replace) |
| `Api.GetCurrentWord` / `GetCurrentSentence` | `docs` | Текущее слово/предложение |
| `Api.ReplaceCurrentWord` / `ReplaceCurrentSentence` | `docs` | Замена текущего |
| `Api.RemoveSelectedContent` | `docs` | Удалить выделение (Builder) |
| `Api.MoveCursorToStart` / `MoveCursorToEnd` | `docs` | Курсор |
| `SearchAndReplace` | `docs` | Поиск-замена по документу |

### Реализация: заменить выделение оформленным HTML (плагин)

```js
Asc.plugin.executeMethod("RemoveSelectedContent", [], function () {
  Asc.plugin.executeMethod("PasteHtml", ["<p><u><b>Новый текст</b></u></p>"]);
});
```

### Реализация: макрос — найти абзац и оформить run

```js
var doc = Api.GetDocument();
for (var i = 0; i < doc.GetElementsCount(); i++) {
  var para = doc.GetElement(i);
  if (!para || !para.GetText) continue;
  if (String(para.GetText()).indexOf("MARKER") === -1) continue;
  var run = para.GetElement(0);
  if (run && run.SetBold) run.SetBold(true);
  if (run && run.SetUnderline) run.SetUnderline(true);
  if (run && run.SetFontFamily) run.SetFontFamily("Arial");
}
```

---

## 3. Шрифт (символ) — Run / TextPr

В Word шрифт **не** на `Paragraph` как на Cell-range: цвет/жирный/размер — через **Run** или **TextPr**.

На уровне Paragraph **unsupported**: `GetColor`, `GetFontFamily`, `GetFontSize`, `GetUnderline`, `GetStrikeout`.

### 3.1. Прямые методы на `ApiRun`

| Метод | Статус | Описание |
|-------|--------|----------|
| `SetBold(bool)` | `supported` | Жирный |
| `GetBold()` | `partial` | Часто **нет** на run из тела документа |
| `SetItalic(bool)` | `supported` | Курсив |
| `SetColor(r,g,b)` | `supported` | Цвет текста |
| `SetFontSize(n)` | `supported` | Размер |
| `SetFontFamily(name)` | `partial` | Имя шрифта (setter) |
| `SetUnderline(...)` | `partial` / `docs` | Подчёркивание — в примере `SetUnderline(true)` |
| `SetStrikeout(...)` | `partial` | Зачёркивание |
| `SetHighlight(...)` | `partial` / `docs` | Маркер |
| `SetShd(...)` | `docs` | Фон символа |
| `SetVertAlign(...)` | `supported`* | super/sub |
| `GetTextPr()` / `SetTextPr(pr)` | `supported` | Объектный путь |
| `SetStyle(style)` | `docs` | Стиль символа |

### Пример (smoke-05): два run, второй жирный и цветной

```js
var para = Api.CreateParagraph();
var r1 = Api.CreateRun();
r1.AddText("обычный ");
var r2 = Api.CreateRun();
r2.AddText("жирный");
r2.SetBold(true);
r2.SetColor(200, 50, 50);
para.AddElement(r1);
para.AddElement(r2);
Api.GetDocument().InsertContent([para]);
```

### 3.2. Через `ApiTextPr`

| Метод | Статус |
|-------|--------|
| `Api.CreateTextPr()` | `supported` |
| `SetBold` / `GetBold` | `supported` |
| `SetItalic` / `GetItalic` | `supported` |
| `SetShd` / `GetShd` | `supported` |
| `SetVertAlign` | `supported` |
| `SetColor` | `partial` (нет GetColor) |
| `SetFontFamily` / `SetFontSize` | `partial` (нет getter) |
| `SetUnderline` / `SetStrikeout` | `partial` (нет getter) |
| `SetHighlight` / `SetFill` / `SetTextFill` | `partial` |

```js
var tp = Api.CreateTextPr();
tp.SetItalic(true);
tp.SetFontFamily("Times New Roman"); // если доступен
tp.SetFontSize(28); // часто half-points — сверить на хосте
var run = Api.CreateRun();
run.AddText("оформленный текст");
run.SetTextPr(tp);
```

### VBA → R7 (шрифт Word)

| VBA | R7 |
|-----|-----|
| `Selection.Font.Bold = True` | run `SetBold(true)` или TextPr |
| `Font.Name = "Arial"` | `SetFontFamily("Arial")` / TextPr |
| `Font.Size = 12` | `SetFontSize(...)` |
| `Font.Color = RGB(...)` | `SetColor(r,g,b)` |
| `Font.Underline = wdUnderlineSingle` | `run.SetUnderline(true)` / TextPr |

---

## 4. Подчёркивание

| Метод | Статус | Пример |
|-------|--------|--------|
| `run.SetUnderline(true)` | `docs` / `partial` | r7c ApiRun |
| `textPr.SetUnderline(...)` | `partial` | без надёжного getter |
| HTML `<u>…</u>` + `PasteHtml` | `docs` | плагин |

```js
var run = Api.CreateRun();
run.AddText("подчёркнутый");
run.SetUnderline(true);
var para = Api.CreateParagraph();
para.AddElement(run);
Api.GetDocument().InsertContent([para]);
```

Через плагин:

```js
Asc.plugin.executeMethod("PasteHtml", ["<p><u>подчёркнутый фрагмент</u></p>"]);
```

---

## 5. Формат абзаца (ParaPr) — не шрифт

```js
var pr = paragraph.GetParaPr();
pr.SetJc("center");
pr.SetIndLeft(720);
pr.SetSpacingAfter(200);
pr.SetShd("clear", 240, 240, 240);
```

| Метод | Статус |
|-------|--------|
| `GetIndLeft` / `SetIndLeft` | `supported` |
| `GetIndRight` / `SetIndRight` | `supported` |
| `GetIndFirstLine` / `SetIndFirstLine` | `supported` |
| `GetJc` / `SetJc` | `supported` |
| `Get/SetSpacingBefore/After` | `supported` |
| `GetSpacingLineValue` / `SetSpacingLine` | `supported` |
| `SetShd` / `GetShd` | `supported` |
| `SetTabs` | `supported` |
| border setters | `supported` |
| `SetNumPr` / `SetBullet` на ParaPr | `partial` (UI часто без маркера) |
| `paragraph.SetParaPr` | `unsupported` |

Копирование оформления абзаца: **`newPara.SetStyle(source.GetStyle())`** — `supported`.

Списки: надёжнее **`Paragraph.Copy()`** + insert, чем `SetBullet` (`partial`).

---

## 6. Таблица внутри Word-документа (не Cell)

Это **не** лист Excel. Формат — по строкам/ячейкам таблицы документа.

| Метод / сценарий | Статус (smoke-02) |
|------------------|-------------------|
| `Api.CreateTable(cols, rows)` + `InsertContent` | `supported` |
| `table.SetWidth("percent", 100)` | `supported` |
| `GetRow` / `GetCell` / `GetContent` / `AddText` | `supported` |
| `row.SetBackgroundColor(r,g,b,false)` | `supported` |
| жирный в ячейке (на para/run) | `supported` |
| `table.MergeCells(...)` | `supported` |

```js
var table = Api.CreateTable(3, 2);
table.SetWidth("percent", 100);
Api.GetDocument().InsertContent([table]);

var row0 = table.GetRow(0);
row0.SetBackgroundColor(220, 230, 240, false);
var cell = row0.GetCell(0);
var para = cell.GetContent().GetElement(0);
para.AddText("Шапка");
if (para.SetBold) para.SetBold(true);
```

«Формат всей Word-таблицы» = цикл по `GetRow` / `GetCell` или оформление шапки + обход ячеек (отдельного TableStyle API в smoke нет).

---

## 7. Content control — формат текста внутри

| Метод | Статус |
|-------|--------|
| `control.SetTextPr(pr)` | `supported` |
| чтение текста | `GetElement(0).GetText()` — не `control.GetText()` |
| white-dot hide | run `"."` + `SetColor(255,255,255)` |

```js
var run = control.GetElement(0);
if (run && run.SetUnderline) run.SetUnderline(true);
if (run && run.SetBold) run.SetBold(true);
```

---

## 8. Чеклист возможностей реализации

| # | Задача | Путь | Готовность |
|---|--------|------|------------|
| 1 | Жирный / курсив / цвет | `run.SetBold` / `SetItalic` / `SetColor` | `supported` |
| 2 | Шрифт и размер | `SetFontFamily` / `SetFontSize` или TextPr | `partial` / `supported` |
| 3 | Подчёркивание | `run.SetUnderline(true)` или `<u>` в PasteHtml | `docs` / `partial` |
| 4 | Формат абзаца (отступы, jc) | `GetParaPr().Set…` | `supported` |
| 5 | Скопировать стиль абзаца | `SetStyle(GetStyle())` | `supported` |
| 6 | Формат выделения (плагин) | RemoveSelected + PasteHtml | `docs` |
| 7 | Формат «всего документа» | цикл по элементам / PasteHtml body | обход, не один метод |
| 8 | Шапка таблицы в Word | `SetBackgroundColor` + bold | `supported` |
| 9 | Скрыть поле формы | white-dot | pattern |

---

## 9. Готовые мини-шаблоны

### A — вставить оформленный абзац

```js
(function () {
  var run = Api.CreateRun();
  run.AddText("Заголовок раздела");
  run.SetBold(true);
  run.SetFontSize(28);
  run.SetUnderline(true);
  run.SetColor(0, 51, 102);
  var para = Api.CreateParagraph();
  para.AddElement(run);
  var pr = para.GetParaPr();
  pr.SetJc("center");
  pr.SetSpacingAfter(200);
  Api.GetDocument().InsertContent([para]);
})();
```

### B — TextPr-пакет

```js
(function () {
  var tp = Api.CreateTextPr();
  tp.SetBold(true);
  tp.SetItalic(false);
  tp.SetUnderline(true); // если метод есть
  var run = Api.CreateRun();
  run.AddText("пакетный формат");
  run.SetTextPr(tp);
  var para = Api.CreateParagraph();
  para.AddElement(run);
  Api.GetDocument().InsertContent([para]);
})();
```

### C — плагин: подчеркнуть/жирный через HTML

```js
Asc.plugin.executeMethod("PasteHtml", [
  "<p style=\"font-family:Arial;font-size:12pt\"><u><b>текст</b></u></p>"
]);
```

### D — white-dot (скрыть опциональное)

```js
control.RemoveAllElements();
var run = Api.CreateRun();
run.AddText(".");
run.SetColor(255, 255, 255);
// attach run к control / parent — по стабильности сборки
```

---

## 10. Ограничения

1. Шрифт/подчёркивание — на **Run/TextPr**, не на Paragraph getters.
2. `GetBold` на body-run может отсутствовать — ориентироваться на визуальный эффект setter.
3. `PasteHtml` **вставляет**, не заменяет выделение — нужен `RemoveSelectedContent` перед ним.
4. Нет проверенного «SelectAll + SetFont» одним API — цикл или HTML.
5. Dropdown list API у SDT — `unsupported`; контролы из шаблона.
6. Protect/Unprotect с паролем в конверсии не используем.

---

## 11. Источники

- `validation/macros/doc/doc-smoke-01` … `05`, `doc-smoke-02-doc-tables.js`
- `docs/doc-macro-methods-handbook.md`
- `knowledge-base/methods/api-method-availability.md`
- `knowledge-base/r7-api-handoff/r7-doc-text-methods.md` (полный каталог текста)
- r7c: `ApiRun/SetUnderline`, `SetBold`, `ApiTextPr/*`, `ApiParagraph/*`

---

*Файл: `knowledge-base/r7-api-handoff/r7-doc-format-selection-font.md`*
