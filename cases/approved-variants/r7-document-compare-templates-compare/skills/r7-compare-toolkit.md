# r7-compare-toolkit — снимок промпта (templates+compare)

Instruction-only skill, v7.0.0. Источник: `cases/compare-r7/skills/r7-compare-toolkit/SKILL.md`.

## START

Список шаблонов — **агент через bash** `ls -la /workspace/Templates/`.  
**2 tool параллельно:** bash ls + `skills activate r7-compare-toolkit`.  
Не читать B на START.

## COMPARE

**1 batch — 2 bash параллельно:**

```
head -c 150000 "/workspace/Templates/{шаблон}.md"
head -c 200000 "<session_file из mentioned.files>"
```

Из B → `body.text` из JSON. Запрет: load_compare_pair, prepare_compare, python3 pipe.

**Выход:** чат + `r7.task` CompareReport `doc-compare/v1`.

## EXPORT

`r7_render_and_deliver_docx` (навык `r7-docx-render`).
