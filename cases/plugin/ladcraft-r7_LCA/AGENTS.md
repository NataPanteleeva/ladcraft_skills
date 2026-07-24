# ladcraft-r7_LCA — будущий плагин (заготовка)

Плагин R7 Desktop под сценарии LCA (в т.ч. агент «Лингвистическая проверка текстов»).  
Код продукта ещё не развёрнут в этой папке; при разработке опираться на канон ниже.

## Обязательное чтение (API Desktop)

| Документ | Зачем |
|----------|--------|
| [`../../knowledge-base/r7-api-handoff/08-desktop-word-probe-results.md`](../../knowledge-base/r7-api-handoff/08-desktop-word-probe-results.md) | Каноны insert/replace/delete/comment на Desktop |
| [`../../knowledge-base/r7-api-handoff/09-desktop-word-formatting.md`](../../knowledge-base/r7-api-handoff/09-desktop-word-formatting.md) | **Формат:** что читать / что задавать при вставке |
| [`../../knowledge-base/r7-api-handoff/07-plugin-integration.md`](../../knowledge-base/r7-api-handoff/07-plugin-integration.md) | `r7.task`, executeMethod / callCommand |
| [`../../LCA/lingvisticheskaya_proverka_vs_desktop_word_api.md`](../../LCA/lingvisticheskaya_proverka_vs_desktop_word_api.md) | ТЗ ↔ API |
| [`../../LCA/r7-doc-text-methods_vs_TZ.md`](../../LCA/r7-doc-text-methods_vs_TZ.md) | Builder-рецепты vs ТЗ |

Пробники (не продукт): `../r7-api-probe/`, `../r7-api-probe-text/`.  
Референс продукта: `../ladcraft-r7_btn_stream/`.

## Инварианты для агента при правках этого плагина

1. **Write в документ** — только из плагина (`Asc.plugin`), не из навыка Ladcraft напрямую.  
2. **Замена выделения:** `RemoveSelectedContent` + Paste*; не `GetRangeBySelect().Delete`.  
3. **Формат при вставке:** задавать явно через `CreateTextPr` / Run setters (`SetFontSize`, `SetFontFamily`, `SetColor`). **Не** рассчитывать на чтение char-format с выделения.  
4. **InsertContent:** только `CreateRun` + `para.AddElement(run)`; голый `para.AddText` + InsertContent на Desktop ломает документ.  
5. **Нумерация списка:** `doc.InsertContent` не наследует пункт списка; `InsertParagraph`+copy format пока без стабильного parent у курсора — не обещать в UX без доп. якоря.  
6. **Комментарии Word:** Add на выделение — ок; Remove/Change через API — нет → замечания лингвопроверки в **чат**.

## Cursor rule

Общий индекс API: `.cursor/rules/ladcraft-r7-office-api.mdc` (п. **09-desktop-word-formatting**).
