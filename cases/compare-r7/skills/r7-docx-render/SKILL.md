---
name: r7-docx-render
description: >-
  Сборка и доставка .docx из CompareReport для R7: r7_render_and_deliver_docx (атомарный export).
  hint r7-docx-render.
version: 2.0.0
mcp_spec:
  default_capabilities:
    required:
      - type: vfs
        scope: $USER
        operations:
          - writeFile
          - mkdir
      - type: vfs
        scope: session
        operations:
          - upload
          - uploadFile
  tools:
    - name: r7_render_and_deliver_docx
      description: >-
        CompareReport → DOCX → session VFS → r7.task deliver_file (атомарно, без base64 в ответе).
      schemas:
        input:
          type: object
          additionalProperties: true
          properties:
            report:
              type: object
              description: CompareReport doc-compare/v1 (объект, НЕ строка).
              additionalProperties: true
        output:
          type: object
          additionalProperties: true
          required:
            - ok
          properties:
            ok:
              type: boolean
            fileId:
              type: string
            fileName:
              type: string
            r7_task_block:
              type: string
            error:
              type: string
    - name: r7_render_docx
      description: Только сборка DOCX в /workspace/out/ (legacy/debug, не для compare-r7 export).
      schemas:
        input:
          type: object
          additionalProperties: true
          properties:
            report:
              type: object
              description: CompareReport doc-compare/v1.
              additionalProperties: true
        output:
          type: object
          additionalProperties: true
          required:
            - ok
          properties:
            ok:
              type: boolean
            localPath:
              type: string
            fileName:
              type: string
            error:
              type: string
---

Ты навык сборки и доставки Word (.docx) для R7 compare-r7. **Без bash, без python.**

Вход: **CompareReport** из `doc-compare` (`schema: doc-compare/v1`).

Источник `report` (приоритет):

1. Аргумент tool от агента (из tool result сравнения)
2. History → `r7.task` → `deliver_inline` / `compare-report.json`
3. **НЕ** пересобирай из markdown чата

## Export compare-r7 (ровно 1 tool)

```
r7_render_and_deliver_docx({ "report": <объект CompareReport> })
```

`report` — **JSON-объект**, не `JSON.stringify`.

**Ответ tool:** `r7_task_block` с `deliver_file` — **дословно** в сообщение пользователю.

Не вызывай `r7_render_docx` + `r7_deliver_docx` / `r7-export-compare` — это устаревшая двухшаговая схема.

## Legacy

`r7_render_docx` — только отладка / другие агенты. Не возвращает `r7.task`.

## Запрещено

| ❌ | ✅ |
|----|-----|
| `python3`, python-docx, pandoc | `r7_render_and_deliver_docx` |
| `report` как строка | объект CompareReport |
| `content_base64` в аргументах/чате | атомарный tool |
| bash `ls` по `/workspace/out/` | tool навыка |
