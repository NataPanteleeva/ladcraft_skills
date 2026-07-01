# Установка плагина Ladcraft в R7 Office

**Каноническая папка (только её):**

```
d:\cursor-lc-headless-main\cases\plugin\ladcraft-r7\
```

Не используйте `plugin/ladcraft-r7` в корне репозитория — там может быть устаревшая копия.

## Проверка версии после установки

1. Откройте плагин в R7 Word.
2. На экране выбора агента должно быть: **Ladcraft v0.4.0** (или новее).
3. В чате `r7-compare-docs`: строка **Агент: r7-compare-docs · v0.4.0**.
4. Кнопка: **«Обновить контекст»**.
5. Статус: **«Документ на диске (id=12345, «…docx»)»** — id обязателен.

Если статус без id или `r7-disk-by-name:` в mentioned — установлен **старый** плагин (< v0.4.0).

## Переустановка с v0.3.x на v0.4.0

1. Закройте R7 Word полностью.
2. В настройках плагинов R7 **удалите** старую регистрацию Ladcraft.
3. `npm run build && npm run verify` в этой папке.
4. Добавьте плагин заново с путём к **этой** папке (см. выше).
5. Откройте документ **с Р7-Диска** (не локальный файл).
6. В чате должно быть **v0.4.0** и debug-строка `Диск: id=… (источник)`.

**Override для отладки** (консоль iframe плагина):

```javascript
localStorage.setItem('ladcraft_r7_disk_document_id_override', '<document_id>');
```

Затем «Обновить контекст».

## Сборка перед установкой

```bash
cd cases/plugin/ladcraft-r7
npm run build
```

В R7 укажите путь к папке с `config.json`, `index.html`, `dist/app.js`.

## Агент на prod

- `r7-compare-docs` → `8UrXveY9LqY8gSmHl2OpM`
- Навык `r7-compare-disk` v1.2.0+ — чтение B по **`host_document_id`** из плагина
