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

## mentioned.files[0]

```json
{
  "file_id": "r7-disk:12345",
  "file_name": "договор.docx",
  "mime_type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
}
```

| Поле | Описание |
|------|----------|
| `file_id` | Синтетический id: префикс `r7-disk:` + numeric `document_id` |
| `file_name` | Имя файла на Р7-Диске |
| `mime_type` | По расширению: `.docx` или `.md` |

## Supplement в content (от плагина)

```text
[Контекст R7: диск]
document_id: 12345
file_name: договор.docx
```

| Поле | Источник |
|------|----------|
| `document_id` | `Asc.plugin.info` / URL `doc.html?id=` |
| `file_name` | title документа |

Агент на START вызывает `r7_list_disk_templates({ host_document_id: 12345 })`.

## Авто-навигация (навыки)

1. `r7_list_disk_templates` — login → «Мои документы» → авто-поиск папки `templates` → list; `ensureCompareFolder("CompareResults")`.
2. `r7_save_compare_report_to_disk` — корень из кэша или climb от кэшированного `templates_directory_id`.

Опциональный override `directory_id` в tool — только для отладки.

## Профили плагина

| Профиль | Агенты | Передача |
|---------|--------|----------|
| `vfs-snapshot` (`doc-compare`) | Сравнение 27, compare-r7 | VFS JSON snapshot |
| `disk-ref` | r7-compare-docs | `r7-disk:{id}` + supplement, без VFS upload |

## Связанные навыки

| Навык | Роль |
|-------|------|
| `r7-compare-disk` | list templates + fetch A/B |
| `r7-report-actions-s27` | вставка / скачать md |
| `r7-save-compare-disk-s27` | сохранить docx на Р7-Диск |
