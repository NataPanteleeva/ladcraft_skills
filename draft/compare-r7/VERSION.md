# compare-r7 — снимок 2026-06-27

Проверено в R7: смысловое сравнение ТТ_десктоп, приемлемая скорость, отчёт в чат.

## Prod

| Сущность | id | Версия |
|----------|-----|--------|
| Агент «R7: сравнение документов» | `Tzr2xtBAyU0_jR1az_a8S` | instruction в `agent/instruction` |
| r7-compare-toolkit (catalog) | `6EOkDFcZIgJD4ZeeG8sXF` | 3.0.0 |
| doc-compare (catalog) | `kUY4vqRPkE2PCWhZQ7z6b` | 1.4.2 |
| r7-docx-render (catalog) | `TRqznAiE55l_vthY5yw_5` | без изменений в снимке |

## Поток сравнения

1. `startup_compare` — приветствие и список шаблонов
2. **doc-compare** — `head` эталона + `read_r7_snapshot_text` + LLM-отчёт (не `compare_documents`)
3. **r7-docx-render** — по запросу Word

`compare_documents` в toolkit оставлен, но **не используется** агентом (эвристика даёт ложные срабатывания на ТТ).
