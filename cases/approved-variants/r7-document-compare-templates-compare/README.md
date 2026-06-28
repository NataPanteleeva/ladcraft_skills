# templates+compare — R7: сравнение документов (рабочий вариант)

**Тег:** `templates+compare`  
**Статус:** одобренный снимок (2026-06-28), **рабочий** на prod v7.0.0  
**Исходный кейс:** [`cases/compare-r7`](../../compare-r7/)

## Суть

| Фаза | Механизм |
|------|----------|
| **START** | `bash ls` Templates + `activate r7-compare-toolkit` → таблица шаблонов |
| **COMPARE** | **2× `bash head`** (A 150k + B 200k) → LLM + **`r7.task`** CompareReport |
| **EXPORT** | `r7-docx-render` → `r7_render_and_deliver_docx` |

Навык `r7-compare-toolkit` — **instruction-only** (без read-tools). Чтение только через host bash.

## Содержимое снимка

| Файл | Назначение |
|------|------------|
| [`agent/instruction`](agent/instruction) | Instruction агента (prod) |
| [`agent/prod.json`](agent/prod.json) | id, привязки, версии |
| [`skills/r7-compare-toolkit.md`](skills/r7-compare-toolkit.md) | Промпт навыка (COMPARE / EXPORT) |
| [`docs/templates-compare.md`](docs/templates-compare.md) | Обоснование, ADR, чеклист |

Полный канон: [`architecture-decisions.md`](../../compare-r7/docs/architecture-decisions.md).

## Навыки на агенте

| Навык | Обязательность |
|-------|----------------|
| `r7-compare-toolkit` | **да** |
| `r7-docx-render` | для EXPORT docx |

## Восстановление на prod

```bash
cd cases/compare-r7
node build_payload.js
node publish_skill_update.js TAJgJW37ybWIP5w7lmGzv payloads/r7-compare-toolkit.json

node ../../.cursor/skills/ladcraft-prod-publish/scripts/ladcraft_prod.js \
  agent-patch wvccZ9WaZMDdCxfTyDGhh \
  --instruction-file cases/approved-variants/r7-document-compare-templates-compare/agent/instruction
```

## Проверено

- Prod skill v7.0.0, tools `[]`, `check_prod_skill.js` ok
- Bash `head` на `/session/r7/` — секунды (Сравнение 27)
- Skill VFS / `load_compare_pair` — отклонено (TIMEOUT ~600 с)
