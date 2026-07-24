# r7-compare-docs-restored

Восстановленная копия кейса **r7-compare-docs** (агент disk-ref, не «Сравнение 27»).

## Источники

| Часть | Откуда |
|-------|--------|
| Навыки, smoke, `publish_and_bind.js` | `cases/r7-compare-docs/` на момент восстановления (локальные disk-ref версии) |
| `agent/instruction` | **prod** — `agent-get 8UrXveY9LqY8gSmHl2OpM` |
| `skill-catalog.json` | из исходной папки (prod ids) |

## Prod

| Сущность | id |
|----------|-----|
| Агент **P7-compare** | `n9ZP1dtuY1p_3PvlNqjCC` |

См. также [`RESTORE.md`](RESTORE.md).

## Публикация

```bash
node cases/r7-compare-docs-restored/publish_and_bind.js
```

После проверки можно заменить повреждённую папку:

```bash
# вручную: переименовать cases/r7-compare-docs → r7-compare-docs.broken
# и r7-compare-docs-restored → r7-compare-docs
```
