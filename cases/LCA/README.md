# LCA — лингвистическая проверка текстов

Агент и навыки для плагина [`ladcraft-r7_new`](../plugin/ladcraft-r7_new/) по ТЗ [`5_agent_lingvisticheskaya_proverka_tekstov.docx`](5_agent_lingvisticheskaya_proverka_tekstov.docx).

## Workspace (БЗ / методика)

Канон файлов для загрузки в primary workspace агента:

[`workspace/`](workspace/) — структура, правила по видам документов, образцы стиля, чек-листы, шаблоны заданий пользователя.

В агенте пути: `/workspace/methodology/...`, `/workspace/rules/{slug}/RULES.md`, …

См. [`workspace/README.md`](workspace/README.md).

## Контракт с плагином

1. Плагин передаёт snapshot / выделение (`mentioned.files`, supplements).
2. Навыки вызывают **tool_calls** (`r7_*`); плагин auto-apply в Word/Cell.
3. После apply плагин шлёт скрытый ```r7.event``` (`apply_result`) — агент продолжает диалог без re-apply.

## Навыки

| Навык | Роль (ТЗ / doc_handler) |
|-------|-------------------------|
| `lca-analyze` | саммари / вопросы (как r7-analyze) |
| `lca-proofread` | К-05 проверка, рекомендации в чате |
| `lca-search-replace` | опечатки, точный find/replace |
| `lca-rewrite` | правка выделения + HTML-оформление (ФТ-03) |
| `lca-generate` | К-06 / С-01 создание + paste |
| `lca-chat` | диалог, мелкие вставки |
| `lca-add-comment` | комментарий рецензента |
| `lca-cell` | ячейки Cell |

**Вне MVP:** export / deliver_file.

## Пути

| Путь | Назначение |
|------|------------|
| `agent/instruction` | маршрутизация С-01/С-02 + r7.event |
| `agent/skill-catalog.json` | slug → skill id (после publish) |
| `skills/lca-*` | навыки |

## Prod (ladcraft.ru)

| Сущность | id |
|----------|-----|
| Агент **Лингвистическая проверка текстов (LCA)** | `f5BwCaKDeDDG71zHJPvid` |
| lca-analyze | `4DiaVNvLdW7onc3gRui63` |
| lca-proofread | `VlCmY241iOBEHNY4MpsIt` |
| lca-search-replace | `KVUxZhcRWEIVCaFrz1ULY` |
| lca-rewrite | `L5j3OgyUKj8ZGuhS3mIPC` |
| lca-chat | `xknIBPMrgRtWG88f5jdpR` |
| lca-generate | `7rq2Zq6tdxTOVppcuLAlk` |
| lca-add-comment | `FBwI3FA0yL2sgMx8LV4gx` |
| lca-cell | `3fneoqEJj0Kkp0jTbQFH7` |

Модель: `minimax-M2.7` (`4ohPFvIN0OJ48pZUR2wFk`).

В плагине **ladcraft-r7_new** выберите агент `f5BwCaKDeDDG71zHJPvid`.

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
