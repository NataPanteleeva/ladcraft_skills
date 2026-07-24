---
name: r7-save-compare-disk-s27
description: Сохраняет markdown-отчёт сравнения на Р7-Диск в папку CompareResults как DOCX (один tool, без вопросов про учётные данные).
version: 1.0.0
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
      description: Логин в Р7-Диск (environment), папка CompareResults, загрузка DOCX с отчётом сравнения.
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
          required:
            - markdown
          properties:
            markdown:
              type: string
              description: Финальный markdown-отчёт сравнения.
            fileName:
              type: string
              description: Имя DOCX (по умолчанию compare-report-YYYY-MM-DD_HH-mm.docx).
            folderName:
              type: string
              description: Имя папки на диске (по умолчанию CompareResults).
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

# Сохранение отчёта сравнения на Р7-Диск

Helper для агента «Сравнение 27». Один вызов tool — полный цикл.

## Когда вызывать

- только после финального отчёта сравнения;
- при явном интенте: `сохранить на диск`, `на диск`.

## Когда не вызывать

- на START / COMPARE;
- без готового markdown-отчёта;
- для вставки в документ / скачивания через плагин (другие helper skills).

## Поведение

1. Login с `credential_source: environment` (переменные установки навыка) — **без** вопроса пользователю.
2. Корень «Мои документы» — авто после login.
3. Папка `CompareResults` — найти в корне или создать.
4. DOCX с `markdown` отчёта — upload через API Диска.

## Ответ агенту

Коротко передай `agent_message` из tool. **Не** выводи `r7.task` — файл уже на диске.
