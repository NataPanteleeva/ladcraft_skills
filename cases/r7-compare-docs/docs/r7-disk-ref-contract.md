# Контракт r7-disk-ref/v1

Передача хост-документа из плагина `ladcraft-r7` в агент **без** VFS upload.

## Установка навыка (минимум)

Только учётные данные Р7-Диска:

| Поле | Обязательно |
|------|-------------|
| `R7_DISK_BASE_URL` | да |
| `R7_DISK_LOGIN` | да |
| `R7_DISK_PASSWORD` | да |

**Не** требуется: id «Мои документы», id `templates`, id `CompareResults`, `R7_COMPARE_TEMPLATES_DIRECTORY_ID`.

## Требование для пользователя

В **«Мои документы»** на Р7-Диске должна быть папка **`templates`** (латиница, регистр не важен) с файлами `.md` / `.docx`. Навык находит её автоматически.

## mentioned.files[0] (основной — по id)

```json
{
  "file_id": "r7-disk:12345",
  "file_name": "Сублицензионный b3.docx",
  "mime_type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
}
```

| Поле | Описание |
|------|----------|
| `file_id` | **`r7-disk:{document_id}`** — обязательно (плагин v0.4.0+) |
| `file_name` | Имя из title редактора (подпись) |
| `mime_type` | По расширению: `.docx` или `.md` |

Устаревший plan B (`r7-disk-by-name:…`) — **не** использовать; навык резолвит B **по id**.

## Supplement в content (от плагина)

```text
[Контекст R7: диск]
document_id: 12345
file_name: Сублицензионный b3.docx
```

| Поле | Источник |
|------|----------|
| `document_id` | Канон: **`doc.html?id=`** / `Documents/Download?id=` (URL редактора в `window.top` и цепочке фреймов). Fallback: суффикс `GUID_…_NNN` в `info.documentId` / `info.key` (**только** если URL недоступен). При конфликте побеждает **URL**. |
| `file_name` | `Asc.plugin.info.title` / `documentTitle` |

Агент на START: `r7_list_disk_templates({ host_document_id: 12345 })` → tool возвращает `host_document_id` и список шаблонов.

Резолв по имени в дереве «Мои документы» — **fallback** в навыке: если id не передан, или `r7_fetch_disk_document` получил HTTP 404 по переданному id (навык ищет по `host_file_name`, как `resolveDocumentIdForFile` в examples_sergey).

## Авто-навигация (навыки)

1. `r7_list_disk_templates` — login → «Мои документы» → авто-поиск папки `templates` → list; `ensureCompareFolder("CompareResults")`.
2. `r7_save_compare_report_to_disk` — корень из кэша или climb от кэшированного `templates_directory_id`.

Опциональный override `directory_id` в tool — только для отладки.

## Профили плагина

| Профиль | Агенты | Передача | Навыки агента |
|---------|--------|----------|----------------|
| `vfs-snapshot` (`doc-compare`) | Сравнение 27, compare-r7 | VFS JSON snapshot | **Обязательно** VFS-навыки (`r7-compare-toolkit`, `read_r7_snapshot_text`, bash) — привязать к агенту на Ladcraft |
| `disk-ref` | r7-compare-docs | `r7-disk:{id}` + supplement, без VFS upload | `r7-compare-disk` + helpers; VFS **не** нужен |

### VFS только при opt-in в плагине

По умолчанию плагин **не** использует VFS. Если для legacy-агента включён профиль `doc-compare`, недостаточно одной настройки плагина: в агента нужно **встроить навыки с чтением VFS** (см. [плагин docs/01-transfer-rules.md](../../plugin/ladcraft-r7/docs/01-transfer-rules.md#vfs-opt-in-и-агент)).

## Связанные навыки

| Навык | Роль |
|-------|------|
| `r7-compare-disk` | list templates + fetch A/B |
| `r7-report-actions-s27` | вставка / скачать md |
| `r7-save-compare-disk-s27` | сохранить docx на Р7-Диск |
