# Паттерны конверсии VBA → R7

## Правила проекта (constraints)

- Макросы: **не использовать** password/unprotect flow.
- Dropdown-контролы **не создавать** в runtime — только в шаблоне.
- Все нужные контролы должны **предсуществовать** в шаблоне.
- Идентификатор контролов: **`GetTag()`**, не `GetTitle()`.
- Теги сумм НДС: `НДС_рубли`, `НДС_копейки` (не путать с `НДС_р` / `НДС_к` без явного маппинга).

---

## DOC: VBA → R7 маппинг

| VBA-концепт | R7 macro | R7 plugin | Уверенность |
|-------------|----------|-----------|-------------|
| ContentControl по tag | `GetAllContentControls()` + filter | plugin resolver | high |
| Сброс зависимого контрола | `RemoveAllElements()` + `SetPlaceholderText()` | form-state reset | high |
| Скрыть опциональный контрол | white-dot run `SetColor(255,255,255)` | CSS concealment | medium |
| Поиск маркерного абзаца | iterate `GetElement(i)` | structured parser | medium |
| Вставка блоков абзацев | `CreateParagraph()` + `InsertParagraph()` | template engine | medium |
| Удаление блоков абзацев | index scan + `RemoveElement(i)` | AST remove | medium |
| Bookmark show/hide | `Bookmarks` + `SetFontHidden` | structural toggle | low |
| Чтение значения контрола | `GetElement(0).GetText()` | form-state | high |
| Добавить текст у контрола | `GetParentParagraph().AddText(...)` | paragraph writer | high |
| Копировать формат абзаца | `newPara.SetStyle(parent.GetStyle())` | style copier | high |
| Массовый сброс с skip-list | scan tags, reset others | batch reset | high |

---

## Паттерны DOC (пошагово)

### doc-placeholder-set
1. `GetAllContentControls()` → filter by tag
2. `RemoveAllElements()`
3. `SetPlaceholderText("...")`

### doc-reset-to-white-dot (скрыть опциональное поле)
1. Clear control content
2. Run с `"."` + белый цвет `(255,255,255)`
3. `AddElement(run)`

### doc-tag-skiplist-reset
1. `GetAllContentControls()`
2. Пропустить теги из `tagsToSkip`
3. Остальным: `RemoveAllElements` + `SetPlaceholderText`

### doc-restore-text-from-markers
- Итерация по абзацам, поиск anchor-текста, восстановление по маркерам (стабильность anchor критична)

### doc-insert-paragraph-blocks / doc-remove-paragraph-blocks
- Вставка: `CreateParagraph()` + `InsertParagraph()` с guard от дублирования
- Удаление: scan индексов + `RemoveElement(i)` со строгими предикатами

---

## Quick workarounds

| Нужно | Избегать | Предпочтительно |
|-------|----------|-----------------|
| Прочитать значение контрола | `control.GetText()` | `control.GetElement(0).GetText()` |
| Найти контрол | только `GetTitle()` | loop + `GetTag()` |
| Обновить текст контрола | прямая мутация | `RemoveAllElements` + run + `AddText` |
| Текст рядом с контролом | `AddElement/Push` на control | `GetParentParagraph().AddText(...)` |
| Скрыть поле | только placeholder | white-dot pattern |
| Сброс многих полей | reset all | skip-list по тегам |
| Формат нового абзаца | клонирование ParaPr | `SetStyle(parent.GetStyle())` |
| Списки/нумерация | только `ParaPr.SetBullet` | `Paragraph.Copy()` + insert |
| Dropdown entries | runtime API | pre-existing template controls |
| Новый SDT | хаки | `CreateInlineLvlSdt` / `CreateBlockLvlSdt` |

---

## TABLES: VBA → R7 маппинг

| VBA-задача | R7-путь | Уверенность |
|------------|---------|-------------|
| Итерация диапазона | cell/range loop | high |
| Массовое форматирование | style methods | medium |
| Удалить листы кроме одного | reverse loop + `Delete()` | high |
| Дедупликация | column → Set → new sheet | high |
| Chunk copy | `GetValue` + chunked `SetValue` | high |
| Глобальный поиск | scan used range | medium |
| Удалить пустые из selection | filter + single column | high |
| Отчёт скрытых строк/столбцов | `Hidden` flags | medium |
| Запись по координатам | `GetRange` / `GetCells` | high |
| Merge/unmerge | `Merge` / `UnMerge` | medium |
| Импорт CSV | ajax + split + `SetValue` | high |
| Текст в A1 | `GetCells(1,1).SetValue` | high |

---

## r7c-code: референсные категории примеров

**Word:** `ApiParagraph`, `ApiTextPr`, `ApiRun`, `ApiParaPr`, `ApiDocumentContent`  
**Cell:** `ApiRange`, `ApiWorksheet`, `Api`  
**Advanced Cell:** `ApiPivotTable`, `ApiPivotField`, `ApiChart`

Примеры лежат в `plugins-inventory/raw/r7c-code/.../examples/` — использовать как отправную точку, сверять с матрицей доступности.
