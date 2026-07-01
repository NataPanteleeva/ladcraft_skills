# P7-compare

Агент сравнения R7: логика «Сравнение 27», transport через **Р7-Диск** (`r7-disk-ref`) вместо VFS snapshot.

**Не путать** с [`cases/compare-s27/`](../compare-s27/) (VFS + bash) и legacy [`cases/r7-compare-docs/`](../r7-compare-docs/).

## Prod

| Сущность | id |
|----------|-----|
| Агент **P7-compare** | `n9ZP1dtuY1p_3PvlNqjCC` |

Instruction: [`agent/instruction`](agent/instruction). Синхронизация: [`agent/.from-server.json`](agent/.from-server.json).

### Привязанные навыки (только эти 4)

| Slug | catalog appId | installed id |
|------|---------------|--------------|
| `r7-compare-disk` | `L_SoujABU0GkKE6zUIhtn` | `QTv0VWzwCmVLI2uHqVUG5` |
| `r7-docx-render-s27` | `_Jf1k7iQQS6ynYOkKezKo` | `xALK4pgPqV_68WBau4PUj` |
| `r7-save-compare-disk-s27` | `ilGf97XEZG0xE5saduycA` | `eNdXvT5VY3RmhPjFHy0kQ` |
| `r7-report-actions-s27` | `UOYiDhp2FgbLFBQACU3XZ` | `8xw6w5_fnQaQKugyGsyoB` |

Индекс: [`skill-catalog.json`](skill-catalog.json).

## Отличие от compare-s27

| | Сравнение 27 | P7-compare |
|---|--------------|------------|
| Шаблоны A | bash `ls /workspace/Templates/` | `r7_list_disk_templates` |
| Документ B | VFS snapshot + bash `head` | `r7_fetch_disk_document` |
| Плагин | `vfs-snapshot` | `disk-ref` |
| DOCX на диск | `r7-save-compare-disk-s27` (minimal) | `r7-docx-render-s27` + save (таблицы Word) |
| Виджет кнопок после COMPARE | нет | `r7_show_compare_actions_widget` |

## Структура

```
cases/p7-compare/
├── agent/instruction
├── docs/
├── r7-compare-disk/
├── r7-docx-render-s27/
├── r7-save-compare-disk-s27/
├── r7-report-actions-s27/
├── skill-catalog.json
├── publish_and_bind.js
└── README.md
```

## Установка `r7-compare-disk` / `r7-save-compare-disk-s27`

- `R7_DISK_BASE_URL` (API-хост `cddisk.*`, не `admin.*`)
- `R7_DISK_LOGIN` / `R7_DISK_PASSWORD`

## Публикация

```bash
node cases/p7-compare/publish_and_bind.js
```

По умолчанию обновляет агента **P7-compare** (`n9ZP1dtuY1p_3PvlNqjCC`). Новый агент: удалите `agentId` из `agent/.from-server.json` или задайте `LC_AGENT_TITLE`.

## Контракт plugin

[`docs/r7-disk-ref-contract.md`](docs/r7-disk-ref-contract.md) — `mentioned.files[0].file_id = "r7-disk:{document_id}"`.
