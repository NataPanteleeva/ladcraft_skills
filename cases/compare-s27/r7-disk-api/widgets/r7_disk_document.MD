---
name: r7_disk_document
description: Виджет отключён — скачивание только ссылкой в agent_message (download_link / web_ui_url).
schema:
  type: object
  additionalProperties: true
  required:
    - ok
  properties:
    ok:
      type: boolean
    operation:
      type: string
    action:
      type: string
    document_id:
      type: integer
    directory_id:
      type: integer
    name:
      type: string
    file_name:
      type: string
    content_text:
      type: string
    content_text_verified:
      type: string
    content_truncated:
      type: boolean
    agent_message:
      type: string
    error:
      type: string
---

<% /* Виджет скачивания отключён. Не рендерить карточки — агент передаёт download_link текстом. */ %>