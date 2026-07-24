# R7 Office API — пакет знаний для переноса

Собрано из репозитория `Macros` (knowledge-base, docs, validation).  
Дата сборки: 2026-07-13.

## Что внутри

| Файл | Содержание |
|------|------------|
| [01-architecture.md](01-architecture.md) | Три слоя API: редактор (Word/Cell), плагин, облачный диск |
| [02-documents-word.md](02-documents-word.md) | API документов: `Api`, Document Builder, `executeMethod` |
| [03-tables-cell.md](03-tables-cell.md) | API таблиц: `Api`, `ApiRange`, `ApiWorksheet`, smoke; **канон redraw viewport после SetValue** |
| [04-disk-api.md](04-disk-api.md) | REST API R7-Диска (файлы и папки) |
| [05-method-availability.md](05-method-availability.md) | Проверенные статусы методов (`supported` / `partial` / `unsupported`) |
| [06-conversion-patterns.md](06-conversion-patterns.md) | VBA→R7: маппинг, паттерны, обходные пути |
| [07-plugin-integration.md](07-plugin-integration.md) | Плагин: `callCommand`, `executeMethod`, протокол `r7.task` |
| [08-desktop-word-probe-results.md](08-desktop-word-probe-results.md) | **Desktop Word:** фактический прогон API (probe 2026-07-14); каноны delete/replace/comment |
| `08-desktop-word-probe-results.docx` | Тот же summary для передачи коллегам |
| [09-desktop-word-formatting.md](09-desktop-word-formatting.md) | **Desktop Word: форматирование** — чтение/запись шрифта, ParaPr, обходы макроса (2026-07-15) |
| [r7-doc-text-methods.md](r7-doc-text-methods.md) | Методы работы с текстом (Document Builder / макросы, перенос из другого проекта) |

## Ключевая идея (кратко)

```
┌─────────────────────────────────────────────────────────────┐
│  R7-Диск (REST)          ≠   Открытый документ в редакторе  │
│  upload/download/move         executeMethod + callCommand   │
└─────────────────────────────────────────────────────────────┘
```

**Открытый документ** (Word/Cell в R7):

1. **Plugin API** — `Asc.plugin.executeMethod(name, args, cb)` — готовые операции моста (вставка HTML, выделение, комментарий).
2. **Document Builder** — `Asc.plugin.callCommand(fn)` — внутри `fn` доступен `Api.*` как в макросах.

**Облачный диск** — отдельный REST API (`/api/v1/Documents/...`, `/api/v1/DocumentDirectory/...`). Плагин редактора его **не вызывает** для работы с открытым файлом.

## Ограничения (важно при проектировании)

- Нет «заменить весь docx одним вызовом» — только точечные операции или план `replace_body` (очистка тела + вставка).
- `PasteHtml` **вставляет** в позицию курсора, не заменяет выделение (нужен `RemoveSelectedContent` + paste или `SearchAndReplace`).
- **Desktop (прогон 2026-07-14):** не использовать `GetRangeBySelect().Delete` — ломает документ; канон — `RemoveSelectedContent`. Подробности — [`08-desktop-word-probe-results.md`](08-desktop-word-probe-results.md).
- **Desktop формат (2026-07-15):** задавать шрифт при вставке через TextPr/Run setters; char-format с выделения не читать. См. [`09-desktop-word-formatting.md`](09-desktop-word-formatting.md).
- Cell: лимит контекста в чат-плагинах ~1000 непустых ячеек (used range).
- Макросы: не использовать password/unprotect; dropdown-контролы не создавать в runtime — только в шаблоне.
- Идентификатор контролов: **`GetTag()`**, не `GetTitle()`.

## Источники в исходном репозитории

- `knowledge-base/plugins/curated/r7-editor-api-reference.md`
- `knowledge-base/plugins/api-specs/r7-disk-api-ks-2024.md`
- `knowledge-base/methods/api-method-availability.md`
- `knowledge-base/methods/doc-methods.md`, `tables-methods.md`
- `knowledge-base/plugins/curated/gptz-plugin-document-actions.md`
- `docs/tables-macro-methods-handbook.md`
- `knowledge-base/patterns/doc-*.md`

## Расположение в этом репозитории

Канонический путь: **`cases/knowledge-base/r7-api-handoff/`** (общий для плагина и всех R7-навыков).

- Индекс knowledge-base: [`../README.md`](../README.md)
- Cursor-правило: `.cursor/rules/ladcraft-r7-office-api.mdc`
- Корневое правило: `.cursor/rules/ladcraft-skills.mdc` (раздел «Раскладка репозитория»)

## Как использовать

1. Перед правкой плагина или R7-навыка открой релевантный файл из таблицы выше (не копируй в папку навыка).
2. При необходимости сверяйся с `06-conversion-patterns.md` и `.cursor/rules/ladcraft-r7-office-api.mdc`.
3. Перед продакшеном перепроверяйте методы на **целевой сборке** R7 (desktop vs server).
