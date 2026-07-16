# r7-doc-text-methods.md ↔ ТЗ «Лингвистическая проверка»

**Источник методов:** [`../knowledge-base/r7-api-handoff/r7-doc-text-methods.md`](../knowledge-base/r7-api-handoff/r7-doc-text-methods.md)  
**ТЗ:** [`5_agent_lingvisticheskaya_proverka_tekstov.docx`](5_agent_lingvisticheskaya_proverka_tekstov.docx)  
**Пробник Builder:** [`../plugin/r7-api-probe-text/`](../plugin/r7-api-probe-text/) v0.2  
**Дата:** 2026-07-15 (с учётом ручного Desktop-прогона)

## Desktop: что из handbook реально для ТЗ

| Рецепт handbook | Desktop факт | Для ТЗ |
|-----------------|--------------|--------|
| `para.AddText` + `InsertContent` | **ломает документ** | не использовать |
| `CreateTextPr` + insert | **ломает / сносит абзац** | не использовать |
| `SetHighlight` | **не работает / ошибка** | не использовать вместо комментариев |
| GetStyle/SetStyle после rewrite | стиль **не** наследуется | не обещать в ФТ-03 |
| **CreateRun + SetBold/SetColor + InsertContent** | **OK** (red bold) | ФТ-05 |
| **Paragraph.Copy** (+ run) | **OK** | усиление вставки |
| find marker → replace run | работает **в одном** callCommand seed+replace | кандидат ФТ-03 |
| PasteHtml / RemoveSelectedContent (старый probe) | OK | канон ФТ-03/05 |

## Рекомендации реализации агента

1. **ФТ-05:** `PasteHtml`/`PasteText` **или** InsertContent **только через Run** (не AddText на абзац).  
2. **ФТ-03:** канон RemoveSelectedContent+Paste; Builder replace-run — только если цитата уникальна и после доп. тестов на стабильность.  
3. **ФТ-04:** только чат; не Highlight и не lifecycle Comments API.  
4. **Форматирование:** SetBold/SetColor на новом Run подтверждены; наследование стиля абзаца при rewrite — **нет**.
