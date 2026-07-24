# Интеграция плагина с R7 API

## Два «документа»

| Слой | Что это | Плагин использует? |
|------|---------|-------------------|
| **Открытый документ** | Word/Cell в редакторе | Да — `executeMethod`, `callCommand` |
| **Файл на R7-Диске** | Папки, upload/download | Нет (отдельная интеграция) |

---

## Матрица: что может / не может плагин

| Действие | Word | Cell | Типичный статус |
|----------|:----:|:----:|-----------------|
| Прочитать весь документ | ✓ | — | callCommand |
| Прочитать used range | — | ✓ | GetUsedRange |
| Прочитать выделение | ✓ | — | GetSelectedText |
| **Перезаписать весь документ** | ✗ | ✗ | planned (`replace_body`) |
| **Заменить выделение** | ✓ | ✗ | **канон:** `RemoveSelectedContent` + paste (не `GetRangeBySelect().Delete`) |
| Вставить HTML | ✓ | — | PasteHtml |
| Записать ячейки A1.. | — | ✓ | SetValue + AutoFit |
| Поиск-замена | ✓ | ✓ | SearchAndReplace |
| Комментарий к выделению | ✓ | — | `executeMethod("AddComment")` / `GetRangeBySelect().AddComment`; legacy `content[0]` → всегда 1-й абзац |
| Content controls, OLE | ✓ | ✓ | API есть, в плагине часто нет |

---

## executeMethod — фактическое использование (GPT_Plugin)

Из ~67 объявленных методов **используются 11:**

| Метод | Назначение |
|-------|------------|
| `GetSelectedText` | Текст выделения |
| `GetSelectionType` | Тип выделения |
| `PasteHtml` / `PasteText` | Вставка |
| `StartAction` / `EndAction` | Блок UI |
| `AddComment` | Комментарий при ошибке |
| `AddContextMenuItem` | Меню Cell |
| `GetMacros` / `SetMacros` | Конвертер макросов |
| `CloseWindow` | Закрыть плагин |

### callCommand — фактически

| Вызов | Назначение |
|-------|------------|
| `GetDocument().GetContent().GetText()` | Текст Word |
| `GetDocument().ToMarkdown()` | Таблицы Word |
| `GetActiveSheet().GetUsedRange().GetValue()` | Матрица Cell |
| `GetRange(addr).SetValue(v)` + `AutoFit()` | Запись ячеек |
| После bulk `SetValue`: 2-й `callCommand` — `Unfreeze` + `Select(A100→home)` | **Канон redraw viewport** (см. `03-tables-cell.md`) |

---

## Протокол `r7.task` (EAI / Ladcraft)

Блок в ответе ИИ:

````markdown
```r7.task
[{ "type": "paste", "data": "<p>...</p>" }]
```
````

| type | R7 метод | Word | Cell |
|------|----------|:----:|:----:|
| `paste` | `PasteHtml` | ✓ | — |
| `paste_text` | `PasteText` | ✓ | — |
| `add_comment` | `AddComment` | ✓ | — |
| `search_replace` | `SearchAndReplace` | ✓ | ✓ |
| `remove_selection` | `RemoveSelectedContent` (Word executeMethod; Cell Clear) | ✓ | ✓ |
| `replace_selection` | Word: `RemoveSelectedContent` + PasteText; Cell: selection SetValue | ✓ | ✓ |
| `cell_paste` | `SetValue` + `AutoFit` | — | ✓ |
| `replace_body` | clear + PasteHtml / ClearContents + SetValue | ✓ | ✓ (planned) |

### Fallback: EAI tool_call

| tool name | → type |
|-----------|--------|
| `r7_add_comment` | `add_comment` |
| `r7_paste` / `r7_paste_html` | `paste` |
| `r7_paste_text` | `paste_text` |
| `r7_cell_paste` | `cell_paste` |
| `r7_search_replace` | `search_replace` |
| `r7_remove_selection` | `remove_selection` |

---

## Сценарии применения

### A. Чат
1. Прочитать документ → vault на платформе
2. Пользователь → ИИ
3. Парсинг `r7.task` → 1–2 вызова R7

### B. Quick action по выделению
1. `GetSelectedText` или used range
2. Генерация на платформе
3. `PasteHtml` / `PasteText` — **вставка**, не replace всего файла

### C. Конвертер макросов
- Только `GetMacros` / `SetMacros` — тело документа не меняется

---

## План `replace_body` (переписать весь документ)

**Word:**
1. `callCommand` — удалить элементы тела документа (`RemoveElement` вниз)
2. `PasteHtml` с новым содержимым

**Cell:**
1. `ClearContents` на used range
2. `cell_paste` с картой ячеек

Отклонено для replace_body: только `paste`, `OpenFile` как замена тела.

---

## Чеклист ID действий (для миграции)

| ID | Действие | Статус |
|----|----------|--------|
| R01 | Прочитать текст Word | supported |
| R02 | Таблицы Word → markdown | supported |
| R03 | Used range Cell | supported |
| R04 | Выделение Word | supported |
| W01 | PasteHtml | supported |
| W03 | cell_paste | supported |
| W04 | Smart replace выделения | unsupported |
| W05 | Перезапись всего документа | unsupported (→ replace_body) |
| W07 | SearchAndReplace | supported (EAI) |
| W09 | GetMacros/SetMacros | supported (GPT only) |

---

## Ограничения

1. Нет полной перезаписи — только вставка или replace_body (план).
2. Чат не меняет документ без `r7.task` / `tool_call`.
3. Cell: ~1000 непустых ячеек в контексте.
4. ИИ не вызывает R7 напрямую — плагин парсит ответ.
5. Disk API — отдельный контур.
