# Чек-лист: лингвистическая проверка (proofread)

Канон: `/workspace/methodology/proofread_core_rules.md` + `error_categories.md`.

## Контекст

- [ ] slug из `contexts.md` или `general`
- [ ] **Core** `proofread_core_rules.md` прочитан
- [ ] `error_categories.md` + этот чек-лист
- [ ] snapshot прочитан один раз
- [ ] slug RULES — только если нужен speech / жанр

## Core-блоки (отметить)

- [ ] **A** orthography — не/чтобы/также/зато/опечатки буквы
- [ ] **B** punctuation — вводные, стык союзов, «и», `,:`, пробелы
- [ ] **C** grammar — управление, согласование причастия
- [ ] **D** speech — только стиль/полная проверка (плеоназм, сочетаемость)
- [ ] **logic** — только по запросу
- [ ] Не лезть в «Вне core»

Scoped («только орфографию» и т.п.) — **только** эта категория.

## Качество пар

- [ ] Только high-confidence; сомнение → пропуск
- [ ] `search` дословно из snapshot
- [ ] Soft-cap ≤15 mechanical (+ ≤5 speech)

## Формат ответа

- [ ] Секции по категориям (пустые не выводить)
- [ ] Таблица **№ | Ошибка | Правильно**, сквозная нумерация
- [ ] Fence findings с `"category"`
- [ ] Маркер `💬` + CTA; документ не изменён
