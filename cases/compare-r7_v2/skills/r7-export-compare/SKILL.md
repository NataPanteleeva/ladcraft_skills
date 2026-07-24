---
name: r7-export-compare
description: >-
  Выгрузка DOCX отчёта сравнения ТЗ в R7: upload в session VFS и deliver_file.
  Только после r7_render_docx. hint r7-export-compare.
version: 1.2.0
tags:
  - document-compare
  - r7
  - export
category: productivity
mcp_spec:
  default_capabilities:
    required:
      - type: vfs
        scope: $USER
        operations:
          - readFile
          - listDir
      - type: vfs
        scope: session
        operations:
          - upload
          - uploadFile
  tools:
    - name: r7_deliver_docx
---

Навык доставки **DOCX** для сценария compare-r7. Универсальный `r7-export` (HTML, paste, share_link) **не используй** — он на других агентах.

## Когда вызывать

- Пользователь: «скачать docx», «сохрани в Word», «docx»
- **После** успешного `r7_render_docx` (skill `r7-docx-render`)

Не вызывай на старте, выборе шаблона, при «скачать» без docx или до готового CompareReport/DOCX.

## Алгоритм (ровно 1 tool)

**Предпочтительно** — только `fileName` (DOCX уже в skill VFS `/workspace/out/` после render):

```
r7_deliver_docx({ "fileName": "<fileName из r7_render_docx>" })
```

Альтернативы: `{ "render": <ответ render> }` или `content_base64` + `fileName`.

Если агент передал `{}` — tool сам ищет последний `.docx` в `/workspace/out/` (fallback).

**Запрещено:** вызывать `r7_deliver_docx({})` намеренно; не копируй `content_base64` в аргументы.

## Ответ агенту

1. Краткий текст: «Отчёт Word готов. Нажмите **Скачать .docx** под этим сообщением».
2. **`r7_task_block`** из ответа tool — **дословно** в сообщение (`deliver_file` с реальным `fileId`).

## Запрещено

- `deliver_inline` / markdown вместо DOCX для сравнения ТЗ
- Завершать сессию без вызова `r7_deliver_docx`
- Плейсхолдер `<uuid>` в `fileId`
- bash `ls`/`cat` по `/workspace/out/`, curl upload
- Имитировать `deliver_file` при `ok: false` — сообщи ошибку кратко

При `ok: false` (VFS upload) — не обещай скачивание DOCX.
