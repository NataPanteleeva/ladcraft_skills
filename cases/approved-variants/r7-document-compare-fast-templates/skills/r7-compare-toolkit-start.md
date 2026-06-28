# r7-compare-toolkit — фрагмент SKILL (снимок fast-templates)

Соответствует `cases/compare-r7/skills/r7-compare-toolkit/SKILL.md` v2.7.0 (тело после frontmatter).

---

## Справочник (канон кейса)

Перед правкой агента или `r7-compare-toolkit` читай: **`cases/compare-r7/docs/approved-r7-document-compare.md`** — одобренный START (bash-список шаблонов) и COMPARE.

## START

Список шаблонов на START даёт **агент через bash** (`ls -la /workspace/Templates/`), не этот навык.

**2 tool параллельно** (иначе R7 обрывает run):
1. `bash` → `ls -la /workspace/Templates/`
2. `skills activate r7-compare-toolkit`

Таблица в ответе: `| № | Название шаблона | Размер |`. Сохрани `session_file` из `mentioned.files`.

Запрещено на START: `startup_compare`; find; cat; python; doc-compare; повторный ls.

## COMPARE

Шаблон **уже выбран** — **не** показывай список шаблонов, **не** `ls` Templates.

**2 read параллельно**, затем сразу отчёт (без `prepare_compare`):

| # | Документ | Действие |
|---|----------|----------|
| 1 | A (эталон) | `bash` → `head -c 150000 "/workspace/Templates/{шаблон}.md"` |
| 2 | B (snapshot) | `read_r7_snapshot_text({ "session_file": "{session_file}", "limit_chars": 100000 })` |

**Запрещено:** `prepare_compare`; `ls` Templates; bash на `/session/r7/`.

По текстам A и B — LLM-сравнение. Выход: резюме, таблица до 10 строк, «**Расхождений: N**», блок `r7.task`.

## EXPORT

docx — `r7_render_and_deliver_docx` (report из r7.task).
