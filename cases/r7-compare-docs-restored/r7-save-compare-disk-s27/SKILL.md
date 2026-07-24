---
name: r7-save-compare-disk-s27
description: DOCX отчёта сравнения → Р7-Диск/CompareResults (один tool, R7_DISK_* из install).
version: 1.2.1
mcp_spec:
  default_capabilities:
    required:
      - type: key-value-storage
        scope: $USER
        operations:
          - Get
          - Set
  tools:
    - name: r7_save_compare_report_to_disk
      description: Login, папка CompareResults, upload DOCX на Р7-Диск.
      environment:
        user:
          R7_DISK_BASE_URL:
            title: Базовый URL Р7-Диска
            format: string
          R7_DISK_LOGIN:
            title: Логин
            format: string
          R7_DISK_PASSWORD:
            title: Пароль
            format: string
            secret: true
      schemas:
        input:
          type: object
          additionalProperties: false
          properties:
            content_base64:
              type: string
              description: DOCX из r7_render_docx (приоритет).
            markdown:
              type: string
              description: Markdown-отчёт (fallback minimal docx).
            fileName:
              type: string
              description: Имя DOCX.
            folderName:
              type: string
              description: Папка на диске (по умолчанию CompareResults).
            folder_id:
              type: integer
              description: Опционально. ID папки CompareResults из предыдущего успешного сохранения — пропускает поиск корня.
        output:
          type: object
          additionalProperties: true
          required:
            - ok
          properties:
            ok:
              type: boolean
            folder_name:
              type: string
            folder_id:
              type: integer
            file_name:
              type: string
            document_id:
              type: integer
            web_ui_hint:
              type: string
            agent_message:
              type: string
            error:
              type: string
---

# r7-save-compare-disk-s27

Один tool после `r7_render_docx`: DOCX → `Мои документы/CompareResults`.

## Вызов

`r7_save_compare_report_to_disk({ content_base64, fileName, markdown, folder_id? })`

- `content_base64` + `fileName` — из `r7_render_docx` (путь `скачать docx`).
- только `markdown` — для `сохранить на диск` / `на диск` (навык сам соберёт DOCX с таблицами).
- `folder_id` — **не обязателен**. Передавайте только если уже есть из предыдущего ответа tool (`folder_id` в успешном сохранении). Иначе навык сам найдёт «Мои документы» и создаст/откроет `CompareResults`.

## ID папок (автоматически)

1. **Корень «Мои документы»** — определяется при login: поля User, probe id=1/0, быстрый скан id 2..128, подъём от `r7_disk_templates_directory_id` в KV, fallback на расшаренный корень.
2. **Папка CompareResults** — создаётся под корнем или берётся из KV (`r7_disk_compare_results_folder_id`).
3. **Override** — `folder_id` в параметрах: загрузка сразу в эту папку (без повторного поиска корня).

Агенту **не** нужно спрашивать у пользователя числовой id папки.

## Триггеры агента

`скачать docx`, `сохранить на диск`, `на диск`.

**Не** вызывать на START/COMPARE/`скачать` md.

## Ответ

Только `agent_message` из tool. Без `r7.task`.

Env: `R7_DISK_BASE_URL`, `R7_DISK_LOGIN`, `R7_DISK_PASSWORD`.
