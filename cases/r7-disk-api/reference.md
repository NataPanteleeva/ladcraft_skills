# Р7-Диск API — справочник

Источник: `instruction-for-ks-2024-api-disk.pdf` (КС 2024).

## Общие правила

- Формат запросов: JSON (`Content-Type: application/json`), кроме Upload (multipart).
- Заголовок авторизации: `Authorization: <AuthToken>` (без префикса Bearer).
- Базовый URL задаётся переменной `R7_DISK_BASE_URL`.

## Авторизация

```
POST {BASE_URL}/api/v2/auth/Login
Body: { "Login": "...", "Password": "..." }
```

Токен: `Response.Data.Tokens.AuthToken`  
Срок: `Response.Data.Tokens.ExpiredAt`

## Папки (DocumentDirectory)

| Операция | Метод | Endpoint | Tool |
|---|---|---|---|
| Содержимое | GET | `/api/v1/DocumentDirectory/Get?id={id}` | `r7_disk_list_directory` (одна папка), `r7_disk_browse` (дерево + `all_documents`) |
| Создать | POST | `/api/v1/DocumentDirectory/AddSubDirectory` | `r7_disk_folder` action `create` |
| Переместить | GET | `/api/v1/DocumentDirectory/Move?Id={id}&toDirectoryId={id}` | `r7_disk_folder` action `move` |
| Копировать | GET | `/api/v1/DocumentDirectory/Copy?Id={id}&toDirectoryId={id}&rule={0\|1\|2}` | `r7_disk_folder` action `copy` |
| Удалить | DELETE | `/api/v1/DocumentDirectory/Delete?Id={id}` | `r7_disk_folder` action `delete` |
| Восстановить | POST | `/api/v1/DocumentDirectory/Restore` body `{ "Ids": [id] }` | `r7_disk_folder` action `restore` |
| Конфликт | POST | `/api/v1/DocumentDirectory/Conflict` body `{ "Ids": [id], "ToDirectoryId": id }` | `r7_disk_folder` action `conflict` |

Ответ `Get` — массив объектов с полями `Children` (подпапки), `Documents` (файлы), `Parent`, `Counters`.

### AddSubDirectory (create)

Тело запроса (KS 2024): `{ "ParentId": <родитель>, "Name": "<имя>" }`. Навык при ошибке 400/422 повторяет с `{ "DirectoryId", "Name" }`.

### Copy rule

| rule | Поведение (типичное) |
|------|----------------------|
| 0 | Отказ при конфликте имён |
| 1 | Перезапись существующей папки |
| 2 | Создание с новым именем при конфликте |

### Переименование папок

В KS 2024 API **нет** `DocumentDirectory/Rename`. Доступны только операции из таблицы выше.

| Что | Переименование в API |
|-----|----------------------|
| **Папка** | **Нет** — используйте веб-интерфейс Р7-Диска или обходной путь: создать папку с новым именем → перенести содержимое (`move`) → удалить старую (`delete`) |
| **Документ (файл)** | **Да** — `GET /api/v1/Documents/Rename?id={id}&name={name}` → `r7_disk_document` action `rename` |

## Документы (Documents)

| Операция | Метод | Endpoint | Tool action |
|---|---|---|---|
| Создать пустой | POST | `/api/v1/Documents/Create` | `create` |
| Загрузить файл | POST | `/api/v1/Documents/Upload` (multipart, header `DirectoryId`) | `upload` |
| Дописать в начало | — (навык: Download+Delete+Upload) | `prepend` |
| Дописать в конец | — (навык: Download+Delete+Upload) | `append` |
| Полная замена | — (навык: Delete+Upload) | `replace` |
| Переименовать | GET | `/api/v1/Documents/Rename?id={id}&name={name}` | `rename` |
| Удалить | POST | `/api/v1/Documents/Delete` body `{ "Ids": [id] }` | `delete` |
| Восстановить | POST | `/api/v1/Documents/Restore` body `{ "Ids": [id] }` | `restore` |
| Переместить | POST | `/api/v1/Documents/Move` body `{ "Ids": [id], "ToDirectoryId": id }` | `move` |
| Копировать | GET | `/api/v1/Documents/Copy?id={id}&directoryId={id}` | `copy` |
| Существует? | GET | `/api/v1/Documents/IsExists?name={name}&directoryId={id}` | `exists` |
| ID по имени | GET | `/api/v1/Documents/GetIdByName?name={name}&directoryId={id}` | `get_id_by_name` |
| Прочитать текст | — (навык: Download + извлечение текста) | `read_content` |
| Скачать | GET | `/api/v1/Documents/Download?id={id}&fileId={fileId}` | `download` |
| Версии | GET | `/api/v1/Documents/Versions?id={id}` | `versions` |
| Смена версии | GET | `/api/v1/Documents/ChangeVersion?id={id}&fileId={fileId}` | `change_version` |
| Конвертация | GET | `/api/v1/Documents/Convert?id={id}&type={format}` | `convert` |

### Upload / Download в навыке

- **Upload:** параметры `file_name`, `content_base64`; тело — `multipart/form-data`, заголовок `DirectoryId`.
- **Download:** виджет отключён; до 5 МБ — `content_base64` + `delivery_method: content_base64` (файл в ответе). Иначе `download_link` = `{BASE}/docs/download?docid={id}&folderid={directoryId}`. После append/prepend — `force_redownload: true`.
- **Prepend / Append (навык):** в API КС 2024 **нет** отдельного endpoint «дописать». Навык: `Download` → **слияние** (старый текст + новый в начало/конец) → `Upload` с заголовком `Id` (**тот же** `document_id`, in-place). Если сервер не сохранил текст — запасной путь `Delete` + `Upload`. **Содержимое не подменяется** — в файле остаётся прежний текст плюс вставка, не `replace`.
- **Replace (навык):** полная замена содержимого переданным `content_text` / `content_base64` (старый текст не сохраняется). Резервная копия (`copy`) — только для таких случаев, см. SKILL.md.

### DOCX с форматированием (навык)

При `create` / `upload` с `name`/`file_name` на `.docx` и `content_text` навык собирает DOCX локально. Поддерживается разметка:

| Разметка | Результат в Word |
|----------|------------------|
| `**текст**` | жирный |
| `*текст*` | курсив |
| `**{26}текст**` | жирный, размер 26 pt (число — пункты) |

Без разметки — обычный текст. Таблицы и сложные стили — через готовый `.docx` в `content_base64`. Сложное форматирование (таблицы, стили) — только через загрузку готового `.docx` в `content_base64`.

## Коды ошибок

- `401` — нужна авторизация или истёк токен
- `404` — не найден (Convert)
- `500` — внутренняя ошибка сервера
