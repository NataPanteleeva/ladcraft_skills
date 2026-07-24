# doc_compare_v1 — пакет для Ladcraft

Папка для загрузки на платформу как навык **doc-compare**.

## Состав

| Файл | Назначение |
|------|------------|
| `SKILL.md` | Единственный обязательный файл навыка |

Скриптов и `mcp_spec` нет — чтение через bash агента.

## Плагин

Требуется `ladcraft-r7` с session VFS и `mentioned.files` на каждом сообщении.

Спека обмена: [`knowledge-base/plugins/curated/ladcraft-r7-doc-compare-transfer.md`](../../plugins/curated/ladcraft-r7-doc-compare-transfer.md).

## Агент

Промпт оркестратора: [`ladcraft-r7-compare-agent-orchestration.md`](../../plugins/curated/ladcraft-r7-compare-agent-orchestration.md).
