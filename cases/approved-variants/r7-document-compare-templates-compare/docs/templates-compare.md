# templates+compare — рабочий вариант R7 document compare

**Тег:** `templates+compare`  
**Статус:** approved, prod v7.0.0 (2026-06-28)

## Проблема

- Skill VFS / `load_compare_pair` на `/session/r7/` — зависание ~600 с на prod.
- `python3 | cat` на session — sandbox reject.

## Решение

1. **START:** bash `ls` Templates + activate `r7-compare-toolkit` (таблица picker).
2. **COMPARE:** host **2× bash head** (A + B), LLM-сравнение, **`r7.task`** CompareReport.
3. Навык без tools — только политика отчёта.

## Эталоны

| Сессия | Что доказала |
|--------|----------------|
| `sSq4sMISgdtM3RwQW9Hrm` (Сравнение 27) | bash head на session OK, ~6 с COMPARE |
| `JGb4lRRCfRVxcjNpBj8yP` (compare-r7) | load_compare_pair TIMEOUT |

## Отличие от `fast-templates`

| | fast-templates | templates+compare |
|---|----------------|-------------------|
| START | bash ls | bash ls (то же) |
| COMPARE | prepare_compare / read_r7 | **2× bash head** |
| r7.task | да | **да** |
| Skill tools | были | **нет** |

## Чеклист приёмки

- [ ] START: ls + activate, таблица, B не читался
- [ ] COMPARE: 2 head в одном batch, без python
- [ ] Ответ: markdown + `r7.task` doc-compare/v1
- [ ] Read &lt; 15 с, полный ход &lt; 2 мин

См. [`architecture-decisions.md`](../../../compare-r7/docs/architecture-decisions.md).
