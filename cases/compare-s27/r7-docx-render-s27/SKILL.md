---
name: r7-docx-render-s27
description: Собирает .docx из CompareReport для агента «Сравнение 27» — следующий шаг r7_save_compare_report_to_disk.
version: 1.0.0
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
      description: DOCX из CompareReport (doc-compare/v1) в /workspace/out/. Без python/bash.
      schemas:
        input:
          type: object
          additionalProperties: true
          properties:
            report:
              type: object
              description: CompareReport (schema doc-compare/v1), собранный из markdown-отчёта.
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

# r7-docx-render-s27

Один tool `r7_render_docx` — сборка DOCX для s27.

## Когда

- только после отчёта с `## Результаты сравнения`;
- интент: `скачать docx` (кнопка плагина шлёт это сообщение дословно).

## Алгоритм

1. Из последнего markdown-отчёта собери `CompareReport` (таблица → `sections[].tables[]`).
2. `r7_render_docx({ report })`
3. Сразу `r7_save_compare_report_to_disk({ content_base64, fileName, markdown })` — **не** `r7_deliver_docx`.

## Запрещено

- `r7_deliver_docx`, `r7-export-compare-s27`, `r7.task` на этом шаге;
- bash/python для DOCX;
- re-COMPARE.
