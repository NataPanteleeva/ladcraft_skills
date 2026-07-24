# R7 Disk API (KS 2024)

Источник: `instruction-for-ks-2024-api-disk.pdf` (ЛАД / Ladcraft).

**Важно:** это API **облачного диска** (файлы и папки), а не API **открытого документа** в редакторе Word/Cell.

## Auth

| Метод | Endpoint | Описание |
|-------|----------|----------|
| POST | `/api/v2/auth/Login` | Логин → `AuthToken`, `RefreshToken` в `Response.Data.Tokens` |

Заголовки запросов: `Content-Type: application/json`, `Authorization: <токен>`.

---

## Папки (`DocumentDirectory`)

| Операция | Метод | Endpoint |
|----------|-------|----------|
| Создание | POST | `/api/v1/DocumentDirectory/AddSubDirectory` |
| Перенос | GET | `/api/v1/DocumentDirectory/Move?Id=&toDirectoryId=` |
| Копирование | GET | `/api/v1/DocumentDirectory/Copy?Id=&toDirectoryId=&rule=` |
| Удаление | DELETE | `/api/v1/DocumentDirectory/Delete?Id=` |
| Восстановление | POST | `/api/v1/DocumentDirectory/Restore` body `{Ids:[]}` |
| Конфликт имён | POST | `/api/v1/DocumentDirectory/Conflict` |
| Содержимое | GET | `/api/v1/DocumentDirectory/Get?id=` |

---

## Документы на диске (`Documents`)

| Операция | Метод | Endpoint |
|----------|-------|----------|
| Создание пустого | POST | `/api/v1/Documents/Create` |
| Загрузка файла | POST | `/api/v1/Documents/Upload` (+ `DirectoryId`, multipart `file`) |
| Переименование | GET | `/api/v1/Documents/Rename?id=&name=` |
| Удаление | POST | `/api/v1/Documents/Delete` body `{Ids:[]}` |
| Восстановление | POST | `/api/v1/Documents/Restore` |
| Перемещение | POST | `/api/v1/Documents/Move` |
| Копирование | GET | `/api/v1/Documents/Copy?id=&directoryId=` |
| Конфликт | POST | `/api/v1/Documents/Conflict` |
| Существует? | GET | `/api/v1/Documents/IsExists?name=&directoryId=` |
| ID по имени | GET | `/api/v1/Documents/GetIdByName?name=&directoryId=` |
| Скачивание | GET | `/api/v1/Documents/Download?id=&fileId=` |
| Версии | GET | `/api/v1/Documents/Versions?id=` |
| Смена версии | GET | `/api/v1/Documents/ChangeVersion?id=&fileId=` |
| Конвертация | GET | `/api/v1/Documents/Convert?id=&type=` → `{TaskId}` |

---

## Связь с плагином редактора

| Задача | API |
|--------|-----|
| Создать/загрузить/скачать файл на диске | Disk REST API |
| Редактировать текст в открытом окне R7 | `executeMethod` / `callCommand` |
| Полная замена docx «с диска» | Disk Upload + открытие в редакторе (отдельный сценарий) |

Плагин GPT/EAI **не вызывает** Disk API для работы с открытым документом.
