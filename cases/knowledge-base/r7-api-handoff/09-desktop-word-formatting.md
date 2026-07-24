# Desktop Word — форматирование: чтение и применение при вставке

**Платформа:** R7 Office **Desktop** (Word)  
**Прогоны:** `r7-api-probe` (2026-07-14), `r7-api-probe-text` v0.3 (2026-07-15)  
**Связанные файлы:** [`08-desktop-word-probe-results.md`](08-desktop-word-probe-results.md), [`r7-doc-text-methods.md`](r7-doc-text-methods.md)  
**Пробник формата:** [`cases/plugin/r7-api-probe-text/`](../../plugin/r7-api-probe-text/)  
**Потребитель:** плагин Desktop, в т.ч. будущий [`ladcraft-r7_LCA`](../../plugin/ladcraft-r7_LCA/)

Документ для агентов и разработчиков плагина: что реально можно сделать с **форматом** на Desktop (не путать с серверной матрицей / полным handbook).

---

## Краткий вердикт (обязательно читать)

| Задача | Desktop факт | Рекомендация для плагина |
|--------|--------------|--------------------------|
| **Задать** при вставке: размер / семейство / цвет / bold | **Работает** | `CreateTextPr` + `SetFontSize` / `SetFontFamily` / `SetColor` / `SetBold` → `run.SetTextPr` **или** те же setters на `CreateRun` |
| **Считать** с выделения char-format (шрифт, размер, bold) | **Практически нет** | Не строить UX «скопировать формат выделения» |
| **Считать** ParaPr (отступы, Jc, spacing) | **Работает** | Можно читать; применять на новый абзац через Set* |
| `GetStyle` | Объект есть | Пригоден для `SetStyle`, не для человекочитаемого лога |
| `GetNumbering` у курсора в списке | Не подтверждён стабильный parent | Не обещать «вставить следующий пункт списка» без доп. якоря абзаца |
| `doc.InsertContent` голый `para.AddText` | **Ломает документ** | Только через **Run + AddElement** |
| `parent.InsertParagraph` + copy format (макрос) | **FAIL** `no-parent` на Desktop (резолв абзаца у курсора) | Пока **не** канон плагина; нужен другой якорь абзаца |
| `parent.AddElement(run)` у курсора | **FAIL** `no-parent` | То же |
| Подхватить нумерацию через `InsertContent` | **Нет** (новый абзац вне списка) | Явно задавать TextPr; для списка — искать обход или Paste |

**Итог для LCA / лингвопроверки:** вставлять исправленный текст с **явно заданным** TNR/размером/цветом (как в проверенном макросе Заказчика). Не полагаться на чтение формата с выделения. Канон замены выделения по-прежнему: `RemoveSelectedContent` + `PasteHtml`/`PasteText` ([`08`](08-desktop-word-probe-results.md)).

---

## 1. Запись формата при вставке (подтверждено Desktop)

### 1.1. Путь макроса (`CreateTextPr`) — OK

```js
var textStyle = Api.CreateTextPr();
textStyle.SetBold(false);
textStyle.SetFontSize(20);              // half-points: 20 → ~10pt
textStyle.SetFontFamily("Times New Roman");
textStyle.SetColor(0, 0, 0, false);

var textRun = Api.CreateRun();
textRun.AddText(textContent);
textRun.SetTextPr(textStyle);

var para = Api.CreateParagraph();
para.AddElement(textRun);
doc.InsertContent([para]);              // только Run+AddElement, не para.AddText
```

Прогон: `Insert TextPr (macro)` — OK; параметры применились.

### 1.2. Setters напрямую на Run — OK

```js
var run = Api.CreateRun();
run.AddText(mark);
run.SetFontSize(28);
run.SetFontFamily("Times New Roman");
run.SetColor(0, 0, 180);
run.SetBold(true);
```

Прогон: `Insert run setters` — OK; визуально крупный синий bold.

### 1.3. Только SetBold / SetColor на Run при InsertContent — OK (частично)

Красный bold на run работает; **нумерация и стиль абзаца окружения не наследуются**.

---

## 2. Чтение формата (прогон Read format @ cursor)

Пример лога (курсор был неоднозначен → fallback на element0):

- `how`: `GetRangeBySelect+fallbackElement0` — **надёжного абзаца у курсора нет**
- `paraPr`: IndLeft/Right/FirstLine, Jc, Spacing* — **getters есть и отдают значения**
- `style`: `[object Object]` — объект стиля есть
- `numbering`: `null` (в том прогоне)
- `run.GetBold`: **`exists: false`**

| Getter | Desktop |
|--------|---------|
| `ParaPr.GetIndLeft/Right/FirstLine` | ok |
| `ParaPr.GetJc` | ok |
| `ParaPr.GetSpacing*` | ok |
| `paragraph.GetStyle` | объект есть |
| `run.GetBold` | нет |
| `TextPr.GetFontSize/Family/Color` | не опираться (часто нет getter) |
| `GetRangeBySelect().GetParagraph` / `GetCurrentParagraph` | **не стабилизировали parent** для InsertParagraph/AddElement |

---

## 3. Обходы из рабочего макроса Заказчика — статус на Desktop

Макрос использует:

1. `createFormattedRun` — **TextPr setters** → перенесён, **подтверждён**  
2. `copyParentFormatting` — GetNumbering/SetNumbering, GetStyle/SetStyle, ParaPr Ind*  
3. `parentPara.InsertParagraph(newPara)` — вставка **после** родительского абзаца  

Пункт (2)+(3) в пробнике: **FAIL `no-parent-para`** — не удалось получить parent у курсора через `GetRangeBySelect` / `GetCurrentParagraph`.

Пока для плагина Desktop:

- использовать (1);  
- (2)+(3) — backlog: якорь абзаца, например поиск `GetElement(i)` по `GetSelectedText` / уникальной цитате.

---

## 4. Что запрещено / опасно (формат и вставка)

| Действие | Статус |
|----------|--------|
| `para.AddText` + `doc.InsertContent` | ломает документ |
| `CreateTextPr` + insert «как попало» без Run (старые пробы) | риск сноса абзаца |
| `SetHighlight` | не работает / ошибка |
| Seed + replace run (Builder) | ошибка документа |
| `GetRangeBySelect().Delete` | ошибка документа ([`08`](08-desktop-word-probe-results.md)) |

---

## 5. Рекомендуемые паттерны плагина (`ladcraft-r7` / LCA)

### Вставка нового фрагмента с известным оформлением договора

```text
CreateRun + TextPr(SetFontFamily TNR, SetFontSize, SetColor)
→ Paragraph.AddElement(run)
→ InsertContent([para])
или PasteHtml с явными стилями в HTML
```

### Замена выделения (исправление лингвопроверки)

```text
RemoveSelectedContent + PasteText|PasteHtml
```

Не: Copy абзаца ради «сохранения нумерации» без проверки; не: ожидать TextPr с выделения.

### Чтение для аналитики (не для copy-format)

```text
GetSelectedText / GetText / ToMarkdown / GetElementsCount+GetElement
+ опционально ParaPr dump
```

---

## 6. Чеклист приёмки формата на Desktop

1. Insert TextPr (macro) — визуально TNR ~10pt (size 20).  
2. Insert run setters — размер/цвет/bold видны.  
3. Read format — ParaPr getters не пустые; GetBold на run может отсутствовать.  
4. InsertParagraph + copy — пока ожидаемо FAIL без улучшения якоря.  
5. Документ после вставок открывается без «Сохранить как…».

---

*Файл: `cases/knowledge-base/r7-api-handoff/09-desktop-word-formatting.md`*
