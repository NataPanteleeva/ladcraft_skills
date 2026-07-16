# Workspace агента LCA (К-03 / К-04)

Локальный канон материалов для рабочей области живого агента.  
В prod после загрузки пути читаются как **`/workspace/...`**.

Источник истины документа пользователя — по-прежнему **snapshot** `/session/r7/...`.  
База знаний / методика — только `/workspace/` (эта папка).

## Дерево

```text
workspace/
  README.md                 ← этот файл (индекс для агента и методолога)
  methodology/              ← К-04 методика (порядок проверки и генерации)
    README.md
    S02_check_and_edit.md
    S01_generate.md
    contexts.md             ← каталог видов документов → папки rules/
  rules/                    ← К-03 наборы правил по виду документа
    _index.md
    general/RULES.md
    letter/RULES.md
    contract/RULES.md
    announcement/RULES.md
    report/RULES.md
    yoda/RULES.md           ← стиль речи Йоды (инверсия)
  style/                    ← образцы оформления (как должно выглядеть)
    general/sample.md
    letter/sample.md
    contract/sample.md
    yoda/sample.md
  checklists/               ← чек-листы навыков
    proofread.md
    generate.md
  prompts/                  ← шаблоны заданий пользователя (для тестов и мето lag)
    user_tasks_check.md
    user_tasks_generate.md
  examples/                 ← учебные примеры до/после
    typos_before_after.md
    yoda_before_after.md
```

## Как навыки обращаются к файлам

В instruction агента и SKILL: при известном **виде документа / контексте** из запроса пользователя:

1. Прочитать каталог: `bash head -c 50000 /workspace/methodology/contexts.md`
2. Выбрать slug (например `letter`, `contract`, `general`).
3. Правила: `bash head -c 120000 /workspace/rules/{slug}/RULES.md`
4. При генерации — ещё образец: `bash head -c 80000 /workspace/style/{slug}/sample.md`
5. Чек-лист: `/workspace/checklists/proofread.md` или `generate.md`

Не делать `find`/`ls -R` по всему workspace в каждом ходе — достаточно `contexts.md` + 1–2 файла по slug.

**Исключение:** на запрос «какие есть правила / стили / шаблоны» — прочитать `contexts.md` и при необходимости `ls` только `rules/`, `style/`, `prompts/`; в ответе — существующие slug, без выдуманных.

Если вид документа **не указан** — брать `general`.

## Соответствие навыкам

| Навык | Читает из workspace |
|-------|---------------------|
| `lca-proofread` | `methodology/S02_*`, `rules/{slug}/RULES.md`, `checklists/proofread.md` |
| `lca-generate` | `methodology/S01_*`, `rules/{slug}/RULES.md`, `style/{slug}/sample.md`, `checklists/generate.md` |
| `lca-analyze` | по желанию `rules/{slug}` для критериев «хорошего» текста |
| `lca-rewrite` / `lca-search-replace` | правила только если нужна стилистика; для «исправь все» — список из чата |
| `lca-chat` | обычно без workspace |

## Как наполнять под Заказчика

1. Скопировать папку `rules/_template/` → `rules/{новый_slug}/RULES.md` (см. шаблон в `general`).
2. Добавить строку в `methodology/contexts.md`.
3. Положите образец в `style/{slug}/sample.md`.
4. При необходимости — кейсы в `prompts/` и `examples/`.

## Загрузка в агент на prod

Файлы из `cases/LCA/workspace/` нужно загрузить в **primary workspace** агента `f5BwCaKDeDDG71zHJPvid` с сохранением относительных путей (`methodology/...`, `rules/...`).  
После загрузки проверка: `bash ls /workspace/methodology` и `bash head -c 2000 /workspace/rules/general/RULES.md`.
