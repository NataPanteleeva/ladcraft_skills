---
name: r7-document-compare
description: >-
  compare-r7 v2 monolith: transport + policy + CompareReport + persist + docx export.
  Один навык вместо toolkit/doc-compare/docx-render.
version: 3.0.5
tags:
  - document-compare
  - r7
  - monolith
category: productivity
mcp_spec:
  default_capabilities:
    required:
      - type: vfs
        scope: $USER
        operations:
          - writeFile
          - mkdir
          - readFile
      - type: vfs
        scope: session
        operations:
          - writeFile
          - readFile
          - upload
          - uploadFile
  tools:
    - name: r7_persist_compare_report
      description: >-
        Сохраняет slim CompareReport в session VFS для EXPORT после compaction.
    - name: r7_render_and_deliver_docx
      description: >-
        CompareReport → DOCX → session VFS → r7.task deliver_file.
---

Навык **compare-r7 v2 (monolith)** — transport, policy, схема отчёта, persist, docx.

Канон ADR: [`architecture-decisions.md`](../../compare-r7/docs/architecture-decisions.md) ADR-001…008.

## START

**2 tool параллельно:**

1. `bash` → `ls -la /workspace/Templates/`
2. `skills activate doc-compare-v2`

Нумерованный список шаблонов. Сохрани `session_file`. **Не читай B** на START. После batch — **0 tools**.

## COMPARE

Шаблон **уже выбран**. **Не** `ls` Templates.

### Один turn — без промежуточного текста

**Запрещено** писать пользователю до финального отчёта: «Запускаю сравнение», «документы прочитаны», статусы между batch. Batch 1–2 — **только tools**, content пустой.

**Batch 1 — только 2× bash параллельно** (без persist):

```
head -c 150000 "/workspace/Templates/{шаблон}.md"
head -c 200000 "<session_file>"
```

Дождись результатов. Собери slim CompareReport в памяти.

**Batch 2 — только 1 tool** (после batch 1, **не параллельно** с bash):

```
r7_persist_compare_report({ "report": <slim CompareReport> })
```

**Batch 3 — финальный текст (0 tool):** резюме + таблица + блок `r7.task` (deliver_inline JSON) + 3 intent-hints. **Обязательно** — без `r7.task` turn не завершён.

### Policy по умолчанию

Единственный редактируемый профиль. Transport не менять.

| Knob | Значение |
|------|----------|
| `compare_mode` | semantic |
| `ignore` | сдвиги нумерации; колонка «наличие»; HTML vs markdown |
| `section_priority` | лицензия → ОС → критичные ФТ → существенные отличия |
| `severity_map` | ⚠️ критичное / 📝 опечатка / Δ отличие |
| `chat_table_max` | **10** в чате |
| `sections_full` | все расхождения в `sections` |

## CompareReport (slim, ADR-007)

В `r7.task` → `deliver_inline` → `content` — JSON **без** `chatMarkdown`:

```json
{
  "schema": "doc-compare/v1",
  "title": "Сравнение документов",
  "meta": {
    "documentA": { "name": "шаблон.md", "role": "эталон" },
    "documentB": { "name": "r7-….json", "role": "сравниваемый" },
    "totalDiffs": 4
  },
  "sections": [{ "heading": "Расхождения", "level": 2, "tables": [{ "headers": ["…"], "rows": [["…"]] }], "quotes": [] }],
  "suggestedFileName": "сравнение.docx"
}
```

| Запрещено в JSON | Нужно |
|------------------|--------|
| `chatMarkdown` / дубль таблицы чата | только `sections` + `meta` |
| `{ id, param, template, document }` | `sections[].tables[]` |

Видимый чат — резюме + таблица; плагин/docx собирают markdown из `sections` (`compareReportToMarkdown`).

### r7.task

```r7.task
[{"type":"deliver_inline","data":{"fileName":"compare-report.json","mimeType":"application/json","encoding":"utf8","content":"<JSON.stringify(slim CompareReport)>","actions":[]}}]
```

### Intent-gated подсказки

После `r7.task` в чате (не в JSON):

- «Чтобы вставить отчёт в документ, напишите: **вставить**»
- «Чтобы скачать отчёт, напишите: **скачать**»
- «Чтобы скачать Word, напишите: **скачать docx**»

Не вопрос («Хотите…») — только императив с «напишите:».

## EXPORT (ADR-008)

Триггер: `скачать docx`, `Word`, `docx` — **не** голое «скачать» (plugin → .md).

**1 tool, 0 bash, 0 activate:**

```
r7_render_and_deliver_docx({ "reportPath": "/session/compare/latest.json" })
```

Fallback: `{ "report": <объект> }` если persist недоступен.

**При ошибке persist:** не bash `mkdir`/`cat`; используй EXPORT fallback с `report`.

**Запрет:** bash, `.tool_results`, пересборка из markdown чата, `skills activate`.

## Запреты (transport)

| Запрещено | Вместо этого |
|-----------|--------------|
| `compare_documents`, `read_r7_snapshot_text` | bash head + LLM |
| post-read `wc`/`python`/`find` | доверять head |
| >2 bash на COMPARE | 2× head |
| EXPORT bash / activate docx | 1× render |
