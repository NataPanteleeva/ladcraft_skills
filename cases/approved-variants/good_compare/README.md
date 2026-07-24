# good_compare — снимок R7 compare (2026-06-29)

**Тег:** `good_compare`  
**Статус:** одобренный локальный снимок  
**Исходные кейсы:** [`cases/compare-r7`](../../compare-r7/), [`cases/compare-s27`](../../compare-s27/)

## Что зафиксировано

| Артефакт | Путь в снимке |
|----------|----------------|
| Навык `r7-compare-toolkit` | [`skills/r7-compare-toolkit/SKILL.md`](skills/r7-compare-toolkit/SKILL.md) |
| Payload навыка (для publish) | [`payloads/r7-compare-toolkit.json`](payloads/r7-compare-toolkit.json) |
| Instruction «R7: сравнение документов» | [`agent/instruction-compare-r7`](agent/instruction-compare-r7) |
| Instruction «Сравнение 27» | [`agent/instruction-compare-s27`](agent/instruction-compare-s27) |
| Prod ids | [`agent/prod.json`](agent/prod.json) |

## Раскладка агентов (не смешивать)

| Агент | id | Кейс |
|-------|-----|------|
| R7: сравнение документов | `wvccZ9WaZMDdCxfTyDGhh` | `compare-r7` — templates+compare, `r7.task` |
| Сравнение 27 | `s_eDSWr8EkRPfDsbgBJxa` | `compare-s27` — простой промпт, без CompareReport |

## Восстановление навыка на prod

```bash
cd cases/compare-r7
node publish_skill_update.js TAJgJW37ybWIP5w7lmGzv \
  ../../approved-variants/good_compare/payloads/r7-compare-toolkit.json
```

## Восстановление instruction агентов

```bash
node .cursor/skills/ladcraft-prod-publish/scripts/ladcraft_prod.js \
  agent-patch wvccZ9WaZMDdCxfTyDGhh \
  --instruction-file cases/approved-variants/good_compare/agent/instruction-compare-r7

node .cursor/skills/ladcraft-prod-publish/scripts/ladcraft_prod.js \
  agent-patch s_eDSWr8EkRPfDsbgBJxa \
  --instruction-file cases/approved-variants/good_compare/agent/instruction-compare-s27
```

## Навык: политика (кратко)

- **START:** bash `ls` Templates + `activate r7-compare-toolkit` (на агенте compare-r7)
- **COMPARE:** 2× `bash head` A+B → LLM + `r7.task` CompareReport `doc-compare/v1`
- **EXPORT:** `r7-docx-render` → `r7_render_and_deliver_docx`
