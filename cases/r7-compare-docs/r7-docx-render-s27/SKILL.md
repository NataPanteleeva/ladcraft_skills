---
name: r7-docx-render-s27
description: Собирает .docx из markdown-отчёта или CompareReport для r7-compare-docs.
version: 1.2.0
mcp_spec:
  default_capabilities:
    required:
      - type: vfs
        scope: $USER
        operations:
          - writeFile
          - mkdir
  tools:
    - name: r7_render_docx
      description: DOCX из markdown-отчёта или CompareReport (doc-compare/v1) в /workspace/out/.
      schemas:
        input:
          type: object
          additionalProperties: true
          properties:
            markdown:
              type: string
              description: Финальный markdown-отчёт сравнения (приоритет).
            report:
              type: object
              description: CompareReport doc-compare/v1 (альтернатива markdown).
        output:
          type: object
          additionalProperties: true
          required:
            - ok
          properties:
            ok:
              type: boolean
            content_base64:
              type: string
            fileName:
              type: string
            agent_message:
              type: string
            error:
              type: string
---

# r7-docx-render-s27 (r7-compare-docs)

Один tool `r7_render_docx` — сборка DOCX с **настоящими Word-таблицами** (не plain markdown).

## Когда

- после отчёта с `## Результаты сравнения` и markdown-таблицей;
- интент: `скачать docx` (кнопка плагина) или шаг перед `r7_save_compare_report_to_disk`.

## Вызов (рекомендуется)

```
r7_render_docx({ markdown: "<текст последнего отчёта>" })
```

Навык сам разберёт markdown-таблицу `| Пункт | Шаблон | … |`. **Не** собирай CompareReport вручную.

Альтернатива: `r7_render_docx({ report: <CompareReport> })`.

## Цепочка на диск

1. `r7_render_docx({ markdown })`
2. `r7_save_compare_report_to_disk({ content_base64, fileName, markdown })`

## Запрещено

- bash/python/pandoc для DOCX;
- `r7_deliver_docx`, `r7-export-compare-s27`;
- re-COMPARE на export.
