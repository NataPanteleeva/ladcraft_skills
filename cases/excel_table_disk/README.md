# excel_table_disk

Server-агент табличной аналитики на **Р7-Диске** (без VFS). Desktop-линейка: [`../excel_pivot_report/`](../excel_pivot_report/).

## Prod (2026-07-22)

| Сущность | Id |
|----------|-----|
| Skill `excel_table_disk_toolkit` | `TXTCgByTrb1s9NNpTYJjL` |
| Installed skill | `H2udoG7E6BdG7EryGPGNv` |
| Agent `Excel Table Disk (R7)` | `dEHOCYkL2H8RjM0wGOE5B` |
| Binding | `Sqy0pbgsRz3cdmEefMeQ4` |
| Workspace | `Lu9CbnJ0kTJ7mCFdcsYc8` |
| Model | `qwen3.5-35B` (`X2GyKB3eVGDc3sY6jZZVr`) |

Плагин должен слать **disk-ref** (не VFS). Канон: агент в `DISK_REF_AGENT_IDS` (ladcraft-r7_new ≥ `0.6.28-disk-table`).  
До пересборки — localStorage override. Все способы привязки vfs/disk-ref (и идеи на будущее):  
[`../plugin/ladcraft-r7_new/docs/01-transfer-rules.md`](../plugin/ladcraft-r7_new/docs/01-transfer-rules.md) § «Варианты привязки профиля».

## Tools

- `list_xlsx_on_disk` — папки / `.xlsx` / текущий документ
- `disk_table_op` — `profile` | `filter` | `pivot` | `top_n` | `compare` → файл на диск

## Publish

```bash
python cases/excel_table_disk/build-skill-payload.py
node .cursor/skills/ladcraft-prod-publish/scripts/ladcraft_prod.js skill-update TXTCgByTrb1s9NNpTYJjL cases/excel_table_disk/.excel-table-disk-skill-payload.json
```

Креды: `install.defaults.json` → `skill-config` на installed id.
