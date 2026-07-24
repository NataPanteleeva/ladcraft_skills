# excel-pivot-ok-14-53-24-07

**Пометка:** ОК на 14:53 24.07  
**Статус:** одобренный локальный снимок  
**Дата:** 2026-07-24

## Что зафиксировано

| Артефакт | Путь в снимке |
|----------|----------------|
| Плагин `ladcraft-r7_new` | [`plugin/ladcraft-r7_new/`](plugin/ladcraft-r7_new/) — **v0.6.62-sheet-callback** |
| Instruction Excel Pivot Report | [`agent/instruction.md`](agent/instruction.md) |
| Prod ids | [`agent/prod.json`](agent/prod.json) |
| Навык `excel_pivot_toolkit` | [`skills/excel_pivot_toolkit/`](skills/excel_pivot_toolkit/) |
| Payload навыка | [`payloads/excel_pivot_toolkit.json`](payloads/excel_pivot_toolkit.json) |
| Канон Cell | [`docs/DATA-FLOW-CANON.md`](docs/DATA-FLOW-CANON.md), [`docs/PLUGIN-R7.md`](docs/PLUGIN-R7.md) |

## Prod ids

| Сущность | id |
|----------|-----|
| Agent `Excel Pivot Report` | `UsL7iqdQLBtYpmP0s7dWF` |
| Skill `excel_pivot_toolkit` | `dCBtc5mdPQV846hIqW0Hp` |

## Почему «ОК»

- Плагин: unlock после callback записи листа; watchdog записи ~12 с; orphan-retry / deliverable-ready для кнопок.
- Агент: multi-turn; clarify/meta без tools; default source = `workbook_path`, не прошлый `Файл:`.

## Восстановление плагина

Скопировать `plugin/ladcraft-r7_new/` в `cases/plugin/ladcraft-r7_new/` (или установить из этой папки в R7). В UI должна быть версия `0.6.62-sheet-callback`.

## Восстановление instruction агента

```bash
node .cursor/skills/ladcraft-prod-publish/scripts/ladcraft_prod.js \
  agent-patch UsL7iqdQLBtYpmP0s7dWF \
  --instruction-file cases/approved-variants/excel-pivot-ok-14-53-24-07/agent/instruction.md
```

## Восстановление навыка на prod

```bash
cd cases/excel_pivot_report
node publish_skill_update.js dCBtc5mdPQV846hIqW0Hp \
  ../approved-variants/excel-pivot-ok-14-53-24-07/payloads/excel_pivot_toolkit.json
```

(если в кейсе другой publish-скрипт — подставьте его; payload в снимке самодостаточен).
