# r7_doc_handler — агент и навыки для плагина R7

Оркестратор по открытому документу Word/Cell: анализ, правки, экспорт. Клон prod-агента **«для плагина»** (`t6WgR4z7hVJypzAXuyT2p`) с полным набором навыков и жёстким чтением snapshot по `mentioned.files`.

## Структура

| Путь | Назначение |
|------|------------|
| `agent/instruction` | Промпт нового агента (READ + маршрутизация) |
| `agent/skill-catalog.json` | Slug → prod skill id (заполнить после publish) |
| `agent/prod.json` | Ссылка на исходный агент |
| `skills/r7-*` | Навыки кейса (8 шт.) |

## Навыки

| Навык | Роль |
|-------|------|
| `r7-analyze` | Вопросы по документу без правок |
| `r7-chat` | Универсальный чат + точечные paste |
| `r7-rewrite` | Переписать выделение (Word) |
| `r7-search-replace` | Найти/заменить |
| `r7-proofread` | Проверка + add_comment |
| `r7-add-comment` | Комментарий рецензента |
| `r7-cell` | Заполнение ячеек Cell |
| `r7-export` | Выгрузка DOCX/HTML (`r7_deliver_docx`) |

## Исправление из чата 4B8BBCE (2026-06-30)

Симптом: на «о чем документ?» агент сначала прочитал правильный `/session/r7/r7-word_4B8BBCE….json` (сублицензионный договор), затем ушёл в `find` → `/workspace/r7/r7-word_0a8d841a….json` и ответил про Docker.

**Фикс в instruction:** только `mentioned.files[0].file_name`, один `head -c 200000`, gate `r7-snapshot/v1`, запрет `/workspace/r7/` и диагностики после успешного READ.

## Prod (ladcraft.ru)

| Сущность | id |
|----------|-----|
| Агент **R7 doc handler (плагин)** | `3pESmwY2EK_EYFwj7TYDS` |
| r7-analyze | `Rw6WMKTxYE1m5UB5WEd5Q` |
| r7-chat | `p6EA8UxwLmprXmaRtfPTE` |
| r7-rewrite | `Jsc76gvtqLXotgt30trwS` |
| r7-search-replace | `i0FgTj8y5k_hEZCJhxYsg` |
| r7-proofread | `kQ65hjeuzx9NcZV_O_PPL` |
| r7-add-comment | `aRjAo8z_RVbqyIoyfo3Ml` |
| r7-cell | `iU17ydVRotYM7NU8mDXZR` |
| r7-export | `TKdUjQpkz9OLC6q5zh4IB` |

**В плагине R7** выберите агент `3pESmwY2EK_EYFwj7TYDS`.

Синхронизация: `agent/.from-server.json`, `agent/skill-catalog.json`.

## Публикация

```bash
cd cases/r7_doc_handler
node publish_and_bind.js   # skills update/create + agent-create + bind
```

Повторный patch instruction:

```bash
node ../../.cursor/skills/ladcraft-prod-publish/scripts/ladcraft_prod.js \
  agent-patch 3pESmwY2EK_EYFwj7TYDS --instruction-file agent/instruction
```

