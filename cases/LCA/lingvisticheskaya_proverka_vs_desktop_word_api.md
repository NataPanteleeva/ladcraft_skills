# Лингвистическая проверка текстов — требования vs Desktop Word API

**Источник требований:** [`5_agent_lingvisticheskaya_proverka_tekstov.docx`](5_agent_lingvisticheskaya_proverka_tekstov.docx)  
**Матрица Desktop API:** [`../knowledge-base/r7-api-handoff/08-desktop-word-probe-results.md`](../knowledge-base/r7-api-handoff/08-desktop-word-probe-results.md)  
**Пробник:** [`../plugin/r7-api-probe/`](../plugin/r7-api-probe/)  
**Дата сводки:** 2026-07-14

Документ для дальнейшей работы по агенту «Лингвистическая проверка текстов» (Ladcraft + плагин Р7 Desktop).  
DOCX-копия для коллег: [`lingvisticheskaya_proverka_vs_desktop_word_api.docx`](lingvisticheskaya_proverka_vs_desktop_word_api.docx).

---

## Что требует ТЗ от документа

| ФТ / сценарий | Действие с документом | Нужные операции |
|---------------|----------------------|-----------------|
| **ФТ-01** | Взять **выделение** или текст **открытого** документа | чтение selection / body |
| **ФТ-02** | Контекст / вид документа | не API редактора (чат + БЗ) |
| **ФТ-03** | **Заменить** выделенный фрагмент исправлением «с сохранением форматирования» | delete selection + paste (лучше HTML) |
| **ФТ-04** | Замечания **в чате**, документ не трогать | документный API не обязателен; опционально комментарии |
| **ФТ-05** / **С-01** | Показать в чате **и/или вставить у курсора** | paste at cursor |
| **С-02** «правка в документе» | то же, что ФТ-03 | replace selection |
| **С-02** «рекомендации в чате» | только чат | без write |

---

## Есть на Desktop (проверено)

| Нужно для ТЗ | Метод / паттерн | Статус |
|--------------|-----------------|--------|
| Текст выделения | `GetSelectedText`, `GetSelectionType` | есть |
| Весь документ | `GetText` / `GetContent`, `ToMarkdown` | есть |
| Вставка у курсора (ФТ-05) | `PasteHtml`, `PasteText` | есть |
| Замена выделения (ФТ-03) | **`RemoveSelectedContent` + `PasteHtml`/`PasteText`** | есть (канон) |
| Массовые точные замены опечаток | `SearchAndReplace` | есть |
| Блок UI на время правки | `StartAction` / `EndAction` | есть |
| Опционально: замечание «к фразе» | `executeMethod("AddComment")` / `GetRangeBySelect().AddComment` | есть (к выделению) |

Этого достаточно для core: **проверить → ответить в чате → вставить / заменить фрагмент**.

---

## Нет на Desktop (или нельзя опираться)

| Желательно по смыслу ТЗ | Метод | Чем заменить |
|-------------------------|-------|--------------|
| Навигация «к следующему замечанию» в тексте | `SearchNext` | руками / только чат; либо S&R по известной цитате |
| Точечная правка «слова под курсором» | `ReplaceCurrentWord` / `ReplaceCurrentSentence` | выделение + remove+paste **или** `SearchAndReplace` |
| HTML-снимок всего файла | `GetFileHTML` | `GetText` / `ToMarkdown` (+ snapshot плагина) |
| Программно убрать/править комментарии | `RemoveComments` / `ChangeComment` / `MoveToComment` | только UI; для ТЗ режим «рекомендации» = **чат**, без комментариев |
| Показать/скрыть разметку рецензии | `SetDisplayModeInReview` | UI пользователя |
| Удаление выделения через range | `GetRangeBySelect().Delete` | **не использовать** — ломает документ |

---

## Риски по формулировкам ТЗ

### «Сохранение форматирования» (ФТ-03)

На Desktop нет проверенного «replace selection с полным CharacterFormat». Реалистичный путь:

- исправление plain → `RemoveSelectedContent` + `PasteText` (форматирование фрагмента почти теряется);
- с разметкой (жирный и т.п.) → `RemoveSelectedContent` + **`PasteHtml`** — частичное сохранение «в пределах возможностей редактора», как и сказано в ТЗ.

### Режим «рекомендации»

Лучше не строить на `AddComment`: добавить можно, **программно снять нельзя**. Канон ТЗ — перечень в чате (ФТ-04).

### Legacy AddComment на 1-й абзац

Не годится для proofread по выделению (всегда якорь на заголовок).

---

## Итог для реализации

| Приоритет | Решение |
|-----------|---------|
| Обязательный минимум | `GetSelectedText` + (опц.) полный `GetText`/`ToMarkdown`; write: `PasteHtml`/`PasteText`; replace: `RemoveSelectedContent` + paste |
| Усиление | `SearchAndReplace` для явных опечаток; `GetSelectionType` как gate «есть ли выделение» |
| Не планировать как API | SearchNext, ReplaceCurrent*, RemoveComments, GetFileHTML, Delete selection |
| ФТ-02 / БЗ / агент | вне document API |

Документ в целом **закрывается** текущим Desktop-набором; узкое место не «отсутствие paste/replace», а **форматирование при replace** и выбор: замечания только в чате, без API-комментариев.

---

## Связанные файлы

| Файл | Назначение |
|------|------------|
| `5_agent_lingvisticheskaya_proverka_tekstov.docx` | ТЗ / описание агента |
| `lingvisticheskaya_proverka_vs_desktop_word_api.md` | этот справочник |
| `lingvisticheskaya_proverka_vs_desktop_word_api.docx` | копия для коллег |
| `../knowledge-base/r7-api-handoff/08-desktop-word-probe-results.md` | полный Desktop-прогон API |
