# fast templates — сопроводительная документация

Вариант **`r7-document-compare-fast-templates`**: одобренный способ **быстро** отдать клиенту R7 список шаблонов для сравнения документов.

## Проблема

На START агент вызывал skill `startup_compare` → VFS `listDir(/workspace/Templates/)`. В R7:

- tool зависал десятки секунд или не завершался;
- список шаблонов не попадал в чат;
- плагин не мог показать picker.

## Решение (fast templates)

| Шаг | Действие |
|-----|----------|
| START | `bash ls -la /workspace/Templates/` + `skills activate r7-compare-toolkit` (параллельно) |
| Ответ | Таблица `\| № \| Название шаблона \| Размер \|` |
| COMPARE | `prepare_compare` — **без** повторного `ls` и без второй таблицы |

Происхождение приёма: агент **«Сравнение 27»** (`s_eDSWr8EkRPfDsbgBJxa`) — тот же `bash ls`, проверенная скорость. Из него **не** перенесён баг повторной подгрузки шаблонов после выбора номера.

## Отклонённые альтернативы

- `startup_compare` / `list_templates` / VFS `listDir` на START
- `skills list_active` в первом batch
- `find` + `ls` (лишний round-trip)
- Повторный список шаблонов на COMPARE

## Чеклист соответствия снимку

- [ ] Instruction совпадает с `agent/instruction` в этой папке
- [ ] START: ровно bash `ls` + activate, таблица в content
- [ ] Нет `startup_compare` на первом сообщении
- [ ] После выбора шаблона — только `prepare_compare`

## Ссылки

- Индекс вариантов: [`cases/approved-variants/manifest.json`](../../manifest.json)
- Живой кейс: [`cases/compare-r7`](../../../compare-r7/)
- Полный канон: [`approved-r7-document-compare.md`](../../../compare-r7/docs/approved-r7-document-compare.md)
