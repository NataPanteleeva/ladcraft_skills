# LCA — лингвистическая проверка текстов

Агент и навыки для плагина [`ladcraft-r7_new`](../plugin/ladcraft-r7_new/) по ТЗ [`5_agent_lingvisticheskaya_proverka_tekstov.docx`](5_agent_lingvisticheskaya_proverka_tekstov.docx).

## Соответствие ТЗ

Чеклист требований и план доработок: [`TZ_REQUIREMENTS_CHECKLIST.md`](TZ_REQUIREMENTS_CHECKLIST.md).

## Workspace (БЗ / методика)

Канон файлов для загрузки в primary workspace агента:

[`workspace/`](workspace/) — структура, правила по видам документов, образцы стиля, чек-листы, шаблоны заданий пользователя.

Приёмочный датасет (docx + сценарии запросов по ФТ/ПМИ): [`acceptance/`](acceptance/).

В агенте пути: `/workspace/methodology/...`, `/workspace/rules/{slug}/RULES.md`, …

См. [`workspace/README.md`](workspace/README.md).

## Контракт с плагином

1. Плагин передаёт snapshot / выделение (`mentioned.files`, supplements).
2. Навыки кладут `r7.proposal` + markdown; плагин intent-apply / tool_calls в Word/Cell.
3. После apply плагин шлёт скрытый ```r7.event``` (`apply_result`) — агент продолжает диалог без re-apply.

### Workspace vs session (UI «Файлы агента»)

| Видно в UI | Ожидание |
|------------|----------|
| `methodology/`, `rules/`, `style/`, `prompts/` | **Общие** между сессиями — БЗ агента |
| `r7/r7-word_*.json` (snapshot) | Привязан к **сессии** чата; path `/session/r7/{sessionSeg}/…`. Несколько старых файлов — хвосты прошлых чатов (плагин чистит best-effort при закрытии) |

Если плагин пишет «Документ не в VFS / путь занят» — нажмите **«Синхр. документ»** или откройте новый чат (с плагина ≥ 0.5.5-vfs1 коллизии path устраняются sessionSeg + delete/retry).


## Навыки (5)

| Навык | Роль |
|-------|------|
| `lca-proofread` | К-05 проверка (`findings`) + fallback X→Y |
| `lca-compose` | генерация / перепись / черновик (`blob`) |
| `lca-analyze` | саммари / вопросы (без вставки по умолчанию) |
| `lca-add-comment` | комментарий рецензента |
| `lca-cell` | ячейки Cell |

Устаревшие (в `skills/_deprecated/`): `lca-generate`, `lca-rewrite`, `lca-chat`, `lca-search-replace`.

**Вне MVP:** export / deliver_file.

## Пути

| Путь | Назначение |
|------|------------|
| `agent/instruction` | маршрутизация С-01/С-02 + r7.event |
| `agent/skill-catalog.json` | slug → skill id (после publish) |
| `agent/spravka-vozmozhnosti.md` | офлайн-справка «что умею» (плагин) |
| `agent/spravka-kak-rabotat.md` | офлайн-справка «как работать» (плагин) |
| `skills/lca-*` | навыки |

## Prod (ladcraft.ru)

| Сущность | id |
|----------|-----|
| Агент **Лингвистическая проверка текстов (LCA)** | `f5BwCaKDeDDG71zHJPvid` |
| lca-analyze | `4DiaVNvLdW7onc3gRui63` |
| lca-proofread | `VlCmY241iOBEHNY4MpsIt` |
| lca-compose | `EnTQEdwfucC1BkOdDcGFx` |
| lca-add-comment | `FBwI3FA0yL2sgMx8LV4gx` |
| lca-cell | `3fneoqEJj0Kkp0jTbQFH7` |

Устаревшие (не биндить): lca-generate, lca-rewrite, lca-chat, lca-search-replace.

Модель: `minimax-M2.7` (`4ohPFvIN0OJ48pZUR2wFk`).

В плагине **ladcraft-r7_new** (≥ `0.6.89-lca-doc-help`) выберите агент `f5BwCaKDeDDG71zHJPvid`.
При открытии чата показывается стартовая справка LCA (редактор документов) со ссылками **Что я умею** / **Как работать** — офлайн, без LLM; текст из `agent/spravka-*.md`, не из справки таблиц.

Синхронизация: `agent/.from-server.json`, `agent/skill-catalog.json`, `agent/prod.json`.

## Publish

```bash
cd cases/LCA
node publish_and_bind.js   # skills create/update + agent-create + bind --install
```

Повторный patch instruction:

```bash
node ../../.cursor/skills/ladcraft-prod-publish/scripts/ladcraft_prod.js \
  agent-patch f5BwCaKDeDDG71zHJPvid --instruction-file agent/instruction
```
