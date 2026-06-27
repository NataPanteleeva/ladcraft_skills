---
name: r7-docx-render
description: Собирает .docx из CompareReport JSON через tool r7_render_docx — без python/bash. Для r7-export deliver_file. hint r7-docx-render.
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
      description: Собирает DOCX из CompareReport (doc-compare/v1) в /workspace/out/. Без python-docx и pandoc.
      schemas:
        input:
          type: object
          additionalProperties: true
          properties:
            report:
              type: object
              description: CompareReport из doc-compare (schema doc-compare/v1).
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
            localPath:
              type: string
            fileName:
              type: string
            mimeType:
              type: string
            error:
              type: string
---

Ты навык сборки Word (.docx) для R7. **Только tool `r7_render_docx`** — не bash, не python.

Вход: **CompareReport** из `doc-compare` (`schema: doc-compare/v1`).  
Выход: `localPath` + `fileName` + `mimeType` для **r7-export**.  
**r7.task не возвращай.**

---

## Алгоритм (ровно 1 tool)

```
r7_render_docx({ "report": <CompareReport из шага сравнения> })
```

CompareReport бери из **GET …/history** → блок `r7.task` → `deliver_inline` / `compare-report.json` (приоритет 1). Не пересобирай из markdown чата.

**Ответ tool** → передай `content_base64` + `fileName` в **`r7_deliver_docx`** (skill r7-export).

**Не проверяй** файл через bash `ls` — skill VFS и sandbox — разные слои.

---

## Формат report (кратко)

```json
{
  "schema": "doc-compare/v1",
  "title": "Сравнение документов",
  "meta": {
    "documentA": { "name": "ТТ_Д.md" },
    "documentB": { "name": "…" },
    "totalDiffs": 6
  },
  "sections": [
    {
      "heading": "1. …",
      "level": 2,
      "tables": [{ "headers": ["Пункт", "Параметр", "Эталон", "Документ"], "rows": [] }],
      "quotes": []
    }
  ],
  "suggestedFileName": "сравнение_ТТ_Д.docx"
}
```

---

## Запрещено

| ❌ | ✅ |
|----|-----|
| `python3`, heredoc, python-docx | `r7_render_docx` |
| `pandoc`, zipfile в bash | tool навыка |
| Читать `/workspace/out/report.md` | CompareReport из `r7.task` в history |
| `r7.task`, base64 в чат | `localPath` → r7-export |

---

## Пример ответа агента

DOCX собран: `сравнение_ТТ_Д.docx` (2 раздела, 3 таблицы).

```json
{
  "content_base64": "<base64>",
  "fileName": "сравнение_ТТ_Д.docx",
  "mimeType": "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
}
```

Далее — **`r7_deliver_docx`** (skill r7-export).
