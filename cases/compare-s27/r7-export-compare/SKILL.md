---
name: r7-export-compare-s27
description: Доставка DOCX отчёта сравнения в R7 через session VFS и r7.task deliver_file.
version: 1.0.0
mcp_spec:
  default_capabilities:
    required:
      - type: vfs
        scope: $USER
        operations:
          - readFile
          - listDir
      - type: vfs
        scope: $USER
        operations:
          - upload
          - uploadFile
  tools:
    - name: r7_deliver_docx
---

Навык отвечает только за доставку готового DOCX:
- upload в session VFS;
- возврат `r7.task` с `deliver_file`.

Когда вызывать:
- только после успешного `r7_render_docx`;
- по явному интенту пользователя «скачать docx / сохранить в Word».

Когда не вызывать:
- на старте;
- при выборе шаблона;
- для markdown/insert сценариев.

В ответе пользователю:
1) короткое подтверждение;
2) `r7_task_block` из tool-результата без изменений.
