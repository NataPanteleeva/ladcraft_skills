# R7 Office — методы работы с текстом документа (Word)

Самодостаточный список для переноса в другой проект.  
Источники: smoke-макросы `validation/macros/doc/`, матрица `api-method-availability.md`, handbook `docs/doc-macro-methods-handbook.md`, примеры r7c-code.  
Проверка: **desktop + server**, 2026-04-18 (где указан статус).

**Легенда статусов**

| Статус | Значение |
|--------|----------|
| `supported` | Работает в прогонах |
| `partial` | Есть setter без getter / API ок, UI может не отразить / нестабильно |
| `unsupported` | Метод отсутствует или не работает |
| `docs` | Есть в справочнике API / примерах; в smoke серии не прогонялся отдельно |

---

## Оглавление

1. [Точка входа](#1-точка-входа)
2. [Документ — структура и текст](#2-документ--структура-и-текст)
3. [Абзац (ApiParagraph)](#3-абзац-apiparagraph)
4. [Run — текстовый фрагмент](#4-run--текстовый-фрагмент)
5. [Контент-контролы (SDT)](#5-контент-контролы-sdt)
6. [Поиск, замена, курсор (Api / plugin)](#6-поиск-замена-курсор)
7. [Блок: форматирование](#7-блок-форматирование)
8. [Готовые рецепты из макросов](#8-готовые-рецепты-из-макросов)
9. [Недоступно / обходы](#9-недоступно--обходы)

---

## 1. Точка входа

| Метод | Статус | Описание |
|-------|--------|----------|
| `Api.GetDocument()` | `supported` | Активный документ Word |
| `Api.GetActiveDocument()` | `docs` | Альтернатива в некоторых хостах |
| `Api.CreateParagraph()` | `supported` | Новый абзац |
| `Api.CreateRun()` | `supported` | Новый текстовый run |
| `Api.CreateTextPr()` | `supported` | Объект свойств текста |
| `Api.CreateInlineLvlSdt()` | `supported` | Inline content control |
| `Api.CreateBlockLvlSdt()` | `supported` | Block content control |
| `Api.CreateTable(rows, cols)` | `supported` | Таблица в теле Word-документа |
| `Api.CreateNumbering(...)` | `partial` | Нумерация; UI часто без маркера |
| `Api.CreateText()` | `unsupported` | Нет в проверенных сборках |
| `Api.CreateParaPr()` | `unsupported` | Нет; брать `paragraph.GetParaPr()` |

```js
var doc = Api.GetDocument();
var para = Api.CreateParagraph();
para.AddText("Привет");
doc.InsertContent([para]);
```

---

## 2. Документ — структура и текст

| Метод | Статус | Описание |
|-------|--------|----------|
| `doc.InsertContent([elements])` | `supported` | Вставить абзацы / SDT / таблицу |
| `doc.GetElementsCount()` | `supported` | Число элементов верхнего уровня |
| `doc.GetElement(i)` | `supported` | Элемент по индексу (часто `ApiParagraph`) |
| `doc.RemoveElement(i)` | `supported` | Удалить элемент по индексу |
| `doc.GetContent()` | `docs` | Объект содержимого (плагин: чтение) |
| `doc.GetContent().GetText()` | `docs` | Весь текст (плагин) |
| `doc.ToMarkdown()` | `docs` | Текст/таблицы в markdown (плагин) |
| `doc.GetAllContentControls()` | `supported`* | Все SDT (*по паттернам проекта) |
| `Api.GetFileHTML` | `docs` | HTML файла |
| `Api.SearchAndReplace` | `docs` | Поиск-замена по документу |
| `Api.SearchNext` | `docs` | Следующее вхождение |
| `Api.ReplaceCurrentWord` / `ReplaceCurrentSentence` | `docs` | Замена текущего слова/предложения |
| `Api.RemoveSelectedContent` | `docs` | Удалить выделение |
| `Api.GetCurrentWord` / `GetCurrentSentence` | `docs` | Текущее слово/предложение |
| `Api.MoveCursorToStart` / `MoveCursorToEnd` | `docs` | Курсор |
| `Api.AddComment` | `docs` | Комментарий |

**Пример: вставка и удаление абзаца** (из `doc-smoke-01`):

```js
var doc = Api.GetDocument();
var p1 = Api.CreateParagraph();
p1.AddText("MARKER_top");
var p2 = Api.CreateParagraph();
p2.AddText("MARKER_middle");
var p3 = Api.CreateParagraph();
p3.AddText("MARKER_bottom");
doc.InsertContent([p1, p2, p3]);

var n = doc.GetElementsCount();
for (var i = 0; i < n; i++) {
  var el = doc.GetElement(i);
  if (el && el.GetText && String(el.GetText()).indexOf("MARKER_middle") !== -1) {
    doc.RemoveElement(i);
    break;
  }
}
```

---

## 3. Абзац (`ApiParagraph`)

| Метод | Статус | Описание |
|-------|--------|----------|
| `AddText(text)` | `supported` | Добавить текст |
| `AddElement(run|sdt|…)` | `supported` | Добавить элемент |
| `AddLineBreak()` | `docs` | Перенос строки |
| `AddTabStop()` | `docs` | Табуляция |
| `GetText()` | `supported` | Текст абзаца |
| `GetElementsCount()` / `GetElement(i)` | `supported` | Элементы внутри абзаца |
| `RemoveElement(i)` / `RemoveAllElements()` | `supported` | Очистка содержимого |
| `GetClassType()` | `supported` | Тип класса |
| `GetStyle()` / `SetStyle(style)` | `supported` | Стиль абзаца |
| `GetParaPr()` | `supported` | Свойства абзаца |
| `SetParaPr(...)` | `unsupported` | Не работает в проверках |
| `GetNumbering()` | `supported` | Есть ли нумерация (проверка наличия) |
| `SetBullet(bullet)` | `partial` | На абзаце; надёжнее `Copy` |
| `Copy()` | `supported` | Копия абзаца (лучший путь для списков в UI) |
| `Delete()` | `docs` | Удалить абзац |
| `GetPrevious()` / `GetNext()` | `docs` | Соседние абзацы |

**Пример:**

```js
var para = Api.CreateParagraph();
para.AddText("Строка 1");
para.AddLineBreak();
para.AddText("Строка 2");
Api.GetDocument().InsertContent([para]);
```

---

## 4. Run — текстовый фрагмент

| Метод | Статус | Описание |
|-------|--------|----------|
| `Api.CreateRun()` | `supported` | Создать run |
| `run.AddText(text)` | `supported` | Добавить текст |
| `run.GetText()` | `supported` | Прочитать текст |
| `run.SetText(...)` | `unsupported` | Нет; менять через clear + AddText |
| `run.GetTextPr()` / `run.SetTextPr(pr)` | `supported` | Свойства текста |
| `run.SetBold(true)` | `supported` | Жирный (setter) |
| `run.GetBold()` | `partial` | Часто **нет** на run из тела документа |
| `run.SetItalic(true)` | `supported` | Курсив |
| `run.SetColor(r, g, b)` | `supported` | Цвет текста |
| `run.SetFontSize(n)` | `supported` | Размер (часто half-points в API) |
| `run.SetFontFamily(name)` | `partial`* | Setter есть в матрице TextPr/Run |
| `run.SetUnderline(...)` | `partial`* | Setter без надёжного getter |
| `run.SetStrikeout(...)` | `partial`* | Setter |
| `run.SetHighlight(...)` | `docs` / `partial` | Подсветка |
| `run.SetShd(...)` | `docs` | Заливка фона символа |
| `run.SetVertAlign(...)` | `supported`* | Надстрочный/подстрочный (через TextPr) |
| `run.AddHyperlink(...)` | `supported`* | Гиперссылка |
| `run.AddDrawing(...)` | `supported`* | Рисунок |
| `run.AddLineBreak()` / `AddTabStop()` | `docs` | Перенос / таб в run |
| `run.ClearContent()` / `RemoveAllElements()` | `docs` | Очистка |
| `run.Copy()` / `Delete()` | `docs` | Копия / удаление |
| `run.SetStyle(...)` | `docs` | Стиль символа |

\* по `api-method-availability` / примерам; визуально проверять на целевой сборке.

**Пример** (из `doc-smoke-05`):

```js
var para = Api.CreateParagraph();
var r1 = Api.CreateRun();
r1.AddText("обычный ");
var r2 = Api.CreateRun();
r2.AddText("жирный красный");
r2.SetBold(true);
r2.SetColor(200, 50, 50);
para.AddElement(r1);
para.AddElement(r2);
Api.GetDocument().InsertContent([para]);
```

---

## 5. Контент-контролы (SDT)

### Идентификация и метаданные

| Метод | Статус |
|-------|--------|
| `GetTag()` / `SetTag(tag)` | `supported` — **канонический ID** |
| `GetAlias()` / `SetAlias()` | `supported` |
| `GetLabel()` / `SetLabel()` | `supported` |
| `GetClassType()` | `supported` |
| `GetTitle()` | `unsupported` |
| `GetLock()` / `SetLock()` | `supported` |

### Содержимое и текст

| Метод | Статус | Комментарий |
|-------|--------|-------------|
| `GetElementsCount()` / `GetElement(i)` | `supported` | Чтение через внутренний run |
| `GetText()` на control | `unsupported` | Использовать `GetElement(0).GetText()` |
| `AddText(text)` на control | `partial` | Лучше через run |
| `RemoveAllElements()` | `supported` | Перед сбросом / placeholder |
| `RemoveElement(i)` | `supported` | |
| `Delete()` | `supported` | Удалить контрол |
| `Copy()` | `supported` | |
| `SetPlaceholderText()` / `GetPlaceholderText()` | `supported` | |
| `GetPlaceholderColor` / `SetPlaceholderColor` | `unsupported` | |
| `SetTextPr(pr)` | `supported` | Формат текста контрола |
| `Select()` | `partial` | Может отсутствовать |
| `AddElement()` / `Push()` на control | `partial` | Нестабильно |
| `Search()` / `ToJSON()` | `supported` | |
| `GetParentParagraph()` | `supported` | Текст рядом: `AddText` на абзац |
| `GetParentTable()` / `GetParentTableCell()` / `GetRange()` | `supported` | |
| `GetDropdownListEntries` / `Set…` / `Clear…` | `unsupported` | Dropdown только из шаблона |
| `GetContent()` | `unsupported` | |

**Пример: создать inline SDT** (из `doc-smoke-03`):

```js
var para = Api.CreateParagraph();
para.AddText("Поле: ");
var cc = Api.CreateInlineLvlSdt();
cc.SetTag("FIELD_1");
cc.SetAlias("Поле 1");
cc.AddText("значение");
cc.SetPlaceholderText("Выберите значение");
para.AddElement(cc);
Api.GetDocument().InsertContent([para]);
```

**Пример: прочитать / дописать текст контрола:**

```js
var el = control.GetElement(0);
var text = el && el.GetText ? el.GetText() : "";
if (el && el.AddText) el.AddText(" +доп");
```

**Пример: сброс placeholder по тегу:**

```js
var controls = Api.GetDocument().GetAllContentControls();
for (var i = 0; i < controls.length; i++) {
  if (controls[i].GetTag() === "FIELD_1") {
    controls[i].RemoveAllElements();
    controls[i].SetPlaceholderText("Выберите значение");
  }
}
```

---

## 6. Поиск, замена, курсор

| Метод / слой | Статус | Описание |
|--------------|--------|----------|
| `Api.SearchAndReplace` | `docs` | Найти и заменить в документе |
| `executeMethod("SearchAndReplace", …)` | `docs` | Мост плагина |
| `executeMethod("GetSelectedText")` | `docs` | Выделение |
| `executeMethod("PasteHtml" / "PasteText")` | `docs` | Вставка (не replace всего файла) |
| `executeMethod("RemoveSelectedContent")` | `docs` | Удалить выделение |
| Обход `GetElement` + `GetText` + правка run | `supported` | Надёжный путь в макросах |

> Полная перезапись документа одним вызовом **недоступна**. Типичный путь: точечные правки или clear body + `PasteHtml` (план `replace_body` в плагине).

---

## 7. Блок: форматирование

Отдельный перечень методов, которые меняют **внешний вид** текста и абзаца.

### 7.1. Формат символов — через Run

| Метод | Статус | Что делает |
|-------|--------|------------|
| `run.SetBold(bool)` | `supported` | Жирный |
| `run.GetBold()` | `partial` | Часто отсутствует на body-run |
| `run.SetItalic(bool)` | `supported` | Курсив |
| `run.SetColor(r, g, b [, …])` | `supported` | Цвет текста |
| `run.SetFontSize(size)` | `supported` | Размер шрифта |
| `run.SetFontFamily(name)` | `partial` | Семейство шрифта (setter) |
| `run.SetUnderline(...)` | `partial` | Подчёркивание (setter) |
| `run.SetStrikeout(...)` | `partial` | Зачёркивание (setter) |
| `run.SetDoubleStrikeout(...)` | `docs` | Двойное зачёркивание |
| `run.SetHighlight(...)` | `partial` / `docs` | Выделение цветом |
| `run.SetShd(...)` | `docs` | Фон символа |
| `run.SetVertAlign(...)` | `supported`* | super/sub |
| `run.SetCaps` / `SetSmallCaps` | `docs` | Капитель |
| `run.SetSpacing(...)` | `docs` | Межсимвольный интервал |
| `run.SetTextFill` / `SetFill` / `SetOutLine` | `partial` / `docs` | Заливка/контур текста |
| `run.SetLanguage(...)` | `docs` | Язык проверки |
| `run.SetPosition(...)` | `docs` | Смещение по вертикали |
| `run.SetStyle(style)` | `docs` | Стиль символа |
| `run.GetTextPr()` + правки `TextPr` + `SetTextPr` | `supported` | Предпочтительный объектный путь |

### 7.2. Формат символов — через `ApiTextPr`

| Метод | Статус |
|-------|--------|
| `Api.CreateTextPr()` | `supported` |
| `SetBold` / `GetBold` | `supported` (на объекте TextPr) |
| `SetItalic` / `GetItalic` | `supported` |
| `SetShd` / `GetShd` | `supported` |
| `SetVertAlign` | `supported` |
| `SetColor` | `partial` (нет `GetColor`) |
| `SetHighlight` | `partial` (нет getter) |
| `SetFill` / `SetTextFill` | `partial` (нет getter) |
| `SetFontFamily` / `SetFontSize` | `partial` (нет getter) |
| `SetUnderline` / `SetStrikeout` | `partial` (нет getter) |
| `SetCaps` / `SetSmallCaps` / `SetSpacing` / `SetOutLine` | `docs` |

**Пример: курсив через TextPr** (из `doc-smoke-05`):

```js
var tp = Api.CreateTextPr();
tp.SetItalic(true);
var run = Api.CreateRun();
run.AddText("курсив");
run.SetTextPr(tp);
var para = Api.CreateParagraph();
para.AddElement(run);
Api.GetDocument().InsertContent([para]);
```

**Пример: скрыть текст белой точкой** (паттерн `doc-reset-to-white-dot`):

```js
control.RemoveAllElements();
var run = Api.CreateRun();
run.AddText(".");
run.SetColor(255, 255, 255);
// предпочтительно через AddElement/Attach — на целевой сборке;
// если AddElement на control нестабилен — через parent paragraph / GetElement
```

### 7.3. Формат абзаца — через `ParaPr`

Получение: `var pr = paragraph.GetParaPr();`

| Метод | Статус | Описание |
|-------|--------|----------|
| `GetIndLeft` / `SetIndLeft` | `supported` | Отступ слева |
| `GetIndRight` / `SetIndRight` | `supported` | Отступ справа |
| `GetIndFirstLine` / `SetIndFirstLine` | `supported` | Красная строка |
| `GetJc` / `SetJc` | `supported` | Выравнивание (`left`/`center`/`right`/`both`) |
| `GetSpacingBefore` / `SetSpacingBefore` | `supported` | Интервал до |
| `GetSpacingAfter` / `SetSpacingAfter` | `supported` | Интервал после |
| `GetSpacingLineValue` / `SetSpacingLine` | `supported` | Межстрочный |
| `SetShd` / `GetShd` | `supported` | Заливка абзаца |
| `SetTabs` | `supported` | Табы |
| border setters | `supported` | Границы абзаца |
| `SetNumPr` / `SetBullet` (на ParaPr) | `partial` | Вызов ок, **маркер в UI часто не виден** |

**Пример выравнивания** (из `doc-smoke-01`):

```js
var pr = paragraph.GetParaPr();
pr.SetJc("center");
```

На абзаце также встречаются прямые шорткаты в примерах r7c: `paragraph.SetJc`, `SetIndLeft`, `SetSpacingBefore` и т.д. — сверять наличие на хосте.

### 7.4. Стили и списки (форматирование структуры)

| Метод / путь | Статус | Рекомендация |
|--------------|--------|--------------|
| `paragraph.GetStyle()` / `SetStyle(style)` | `supported` | **Лучший** перенос формата на новый абзац |
| `paragraph.Copy()` + `InsertContent` | `supported` | **Лучший** путь продолжить список в UI |
| `paragraph.GetNumbering()` | `supported` | Проверка «есть нумерация» |
| `ParaPr.SetBullet` / `SetNumPr` | `partial` | Не полагаться на UI |
| `Api.CreateNumbering` + `Paragraph.SetBullet` | `partial` | Пробовать после Copy |
| `GetNumberingRule` / `GetNumberingLevel` | `unsupported` | Нет в проверках |

**Копирование формата абзаца:**

```js
var newPara = Api.CreateParagraph();
newPara.AddText("новый пункт");
newPara.SetStyle(sourcePara.GetStyle());
Api.GetDocument().InsertContent([newPara]);
```

### 7.5. Что НЕ форматировать на уровне Paragraph

На самом абзаце **unsupported**: `GetColor`, `GetFontFamily`, `GetFontSize`, `GetUnderline`, `GetStrikeout`.  
Шрифт / цвет / жирный — только через **Run** или **TextPr**.

---

## 8. Готовые рецепты из макросов

### Вставить текст

```js
var doc = Api.GetDocument();
var p = Api.CreateParagraph();
p.AddText("Текст");
doc.InsertContent([p]);
```

### Найти абзац по маркеру и заменить текст первого run

```js
var doc = Api.GetDocument();
for (var i = 0; i < doc.GetElementsCount(); i++) {
  var para = doc.GetElement(i);
  if (!para || !para.GetText) continue;
  if (String(para.GetText()).indexOf("MARKER") === -1) continue;
  var run = para.GetElement(0);
  if (run && run.RemoveAllElements) run.RemoveAllElements();
  if (run && run.AddText) run.AddText("новый текст");
  // либо: para.RemoveAllElements(); + CreateRun + AddElement
}
```

### Текст рядом с контролом

```js
control.GetParentParagraph().AddText(" …добавка");
```

### Массовый сброс контролов с skip-list

```js
var skip = { "НДС_рубли": 1, "НДС_копейки": 1 };
var list = Api.GetDocument().GetAllContentControls();
for (var i = 0; i < list.length; i++) {
  var tag = list[i].GetTag && list[i].GetTag();
  if (skip[tag]) continue;
  list[i].RemoveAllElements();
  list[i].SetPlaceholderText("Выберите значение");
}
```

---

## 9. Недоступно / обходы

| Нужно | Избегать | Делать так |
|-------|----------|------------|
| Прочитать значение SDT | `control.GetText()` | `control.GetElement(0).GetText()` |
| Найти контрол | только `GetTitle()` | `GetTag()` |
| Обновить текст SDT | «магия» мутации | `RemoveAllElements` + run + `AddText` |
| Скрыть опциональное поле | только placeholder | white-dot: `"."` + `SetColor(255,255,255)` |
| Списки / нумерация | только `SetBullet` на ParaPr | `Paragraph.Copy()` → insert; затем `SetStyle` |
| Dropdown entries в runtime | API списка | контролы в **шаблоне** |
| Цвет/шрифт абзаца на Paragraph | `para.GetColor()` и т.п. | Run / TextPr |
| Password protect | Protect/Unprotect | не использовать в конверсии |

---

## Источники в исходном репозитории

- `validation/macros/doc/doc-smoke-01` … `07`, `doc-all-methods-smoke.js`
- `docs/doc-macro-methods-handbook.md`
- `knowledge-base/methods/api-method-availability.md`
- `knowledge-base/methods/quick-workarounds.md`
- `knowledge-base/patterns/doc-*.md`
- `plugins-inventory/raw/r7c-code/.../examples/ApiParagraph|ApiRun|ApiTextPr/`

---

*Файл: `knowledge-base/r7-api-handoff/r7-doc-text-methods.md`*
