# Knowledge base (cases)

Общие справочные материалы для нескольких кейсов, навыков и плагина.  
**Не** дублировать в папки отдельных навыков — один источник на репозиторий.

## R7 Office API

**`r7-api-handoff/`** — пакет знаний по API редактора R7 Office (Word/Cell), плагина и Р7-Диска.

| Когда читать | С чего начать |
|--------------|---------------|
| Плагин `ladcraft-r7`, `r7.task`, вставка в документ | [`r7-api-handoff/07-plugin-integration.md`](r7-api-handoff/07-plugin-integration.md) |
| API документов Word, `executeMethod`, Document Builder | [`r7-api-handoff/02-documents-word.md`](r7-api-handoff/02-documents-word.md) |
| Таблицы / Cell | [`r7-api-handoff/03-tables-cell.md`](r7-api-handoff/03-tables-cell.md) |
| REST Р7-Диск (навыки `r7-disk-api`, disk-ref) | [`r7-api-handoff/04-disk-api.md`](r7-api-handoff/04-disk-api.md) |
| Доступность методов на сборке R7 | [`r7-api-handoff/05-method-availability.md`](r7-api-handoff/05-method-availability.md) |
| VBA → R7, обходные пути | [`r7-api-handoff/06-conversion-patterns.md`](r7-api-handoff/06-conversion-patterns.md) |

Полный индекс: [`r7-api-handoff/README.md`](r7-api-handoff/README.md).

## Смежные контракты (не vendor API)

| Тема | Путь |
|------|------|
| Плагин → агент (VFS, snapshot, disk-ref) | `cases/doc_compare/docs/r7-plugin-data-contract.md` |
| Правила плагина (блоки 1–3) | `cases/plugin/ladcraft-r7_btn_stream/docs/` |
| Сравнение документов (START/COMPARE) | `cases/compare-r7/docs/approved-r7-document-compare.md` |
