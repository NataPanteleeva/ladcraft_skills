# Ladcraft Publish Checklist

Используй этот список перед тем, как говорить, что draft готов к publish.

## Обязательные файлы

- Есть `application.json`
- Есть `skill.md`
- Есть `.ladcraft.json`
- Есть хотя бы один `tools/<tool>.json`
- Есть хотя бы один `tools/<tool>.js`
- Если нужен виджет, есть `widgets/<tool>.ejs`

## Обязательные поля

- `application.name` не пустой
- `application.description` не пустой
- `application.version` не пустой
- `application.category` не пустой и валиден
- `skill.md` не пустой
- У каждого инструмента непустые `name`, `description`, `function`

## Tool consistency

- `tool.name` совпадает с basename файлов
- Нет stale дубликатов после переименования инструмента
- Нет конфликтующих файлов для одного и того же tool name
- `tools/*.js` не обрезан и синтаксически завершён

## Resources

- `tools[].resources.timeout` задан в секундах
- `tools[].resources.timeout` в диапазоне `1..3600`
- `resources.network.hosts` отражает реальные хосты, а не случайные значения

## Перед publish

- Если draft уже существовал, он исправлен на месте, а не пересоздан без необходимости
- Использован ближайший reference (`weather-builder` или `diablo-builder`)
- изменения не выходят за пределы `/skills_builder/` ради правки draft
- После изменений критические файлы перечитаны целиком

## Если publish падает

Сначала проверь:

1. категорию
2. timeout
3. обязательные поля
4. целостность `tools/*.js`
5. stale tool-файлы
