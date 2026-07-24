---
name: r7-compare-toolkit
description: >-
  compare-r7 v2: bash ls Templates на START; 2× bash head на COMPARE; LLM + r7.task.
  Instruction-only — skill tools не вызывать на prod.
version: 3.2.0
tags:
  - document-compare
  - r7
  - bash-head
category: productivity
mcp_spec:
  tools: []
---

Политика compare-r7 **v2** (instruction-only). Скрипты в `scripts/` — для локальных тестов, **не** вызывать на prod.

Канон: [`cases/compare-r7/docs/architecture-decisions.md`](../../compare-r7/docs/architecture-decisions.md) ADR-001, ADR-005, ADR-006.

## START

**2 tool параллельно** (иначе R7 обрывает run):

1. `bash` → `ls -la /workspace/Templates/`
2. `skills activate r7-compare-toolkit-v2`

Нумерованный список шаблонов из `ls`. Сохрани `session_file` из `mentioned.files`. **Не читай B** на START.

После batch — **0 tools**, сразу ответ пользователю.

**Запрет на START:** `head`/`cat` на B; `startup_compare`; `read_r7_snapshot_text`; python; pipe; `find`; `ls` session; второй batch tool.

## COMPARE

Шаблон **уже выбран** — **не** список шаблонов, **не** `ls` Templates.

**1 batch — 2 bash параллельно**, затем **0 tools** — LLM-отчёт. **Запрещён 2-й batch** на этой фазе:

```
head -c 150000 "/workspace/Templates/{шаблон}.md"
head -c 200000 "<session_file>"
```

Альтернатива A (пробелы в пути): `cat "/workspace/Templates/{шаблон}.md" | head -c 150000`

### Парсинг B (без post-read)

- stdout B с `"r7-snapshot/v1"` или `"body"` → read успешен; извлечь **`body.text`**.
- **Не** запускать `wc`, `cat` на B, `python`, `find`, `ls` session / `.tool_results` после `head`.

**Смысл сравнения** — см. **doc-compare-v2**, раздел **Policy по умолчанию** (ignore, severity, section_priority, выход).

**Выход:** резюме + до **10** критичных в таблице + «**Расхождений: N**» + `r7.task`:

```r7.task
[{"type":"deliver_inline","data":{"fileName":"compare-report.json","mimeType":"application/json","encoding":"utf8","content":"<CompareReport одной строкой>","actions":[]}}]
```

CompareReport: `schema: doc-compare/v1`, `sections` — все расхождения.

**Запрет (post-read и fallback):** `wc`; `cat` на B; `python`/`python3`; `find`; `jq`; `ls` session / `.tool_results`; повторный `head`/`cat` на B; `load_compare_pair`; `prepare_compare`; `read_r7_snapshot_text`; `compare_documents`; `startup_compare`; любой 2-й batch tool.

**Ошибка read B:** одно сообщение + перезапуск из R7; без fallback-tool.

## EXPORT

`skills activate r7-docx-render-v2` → `r7_render_and_deliver_docx({ report })`.
