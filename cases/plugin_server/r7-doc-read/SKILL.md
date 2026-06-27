---
name: r7-doc-read
description: Read R7 document slots from r7-doc-bundle/v1 via bash head (session VFS + workspace templates).
---

# r7-doc-read

Универсальное чтение слотов документов для multi-doc агентов Ladcraft R7 Server.

## Вход

1. Блок `[R7-DOC-BUNDLE]` в `content` пользовательского сообщения
2. `mentioned.files[]` — session paths плагина

## Алгоритм

1. Распарсить JSON `r7-doc-bundle/v1`
2. Для каждого слота с `origin: open_tab` | `host`:
   - `bash head -c 120000 {path}` — path из `slot.path`
   - Проверить `r7-snapshot/v1` и `body.text`
3. Для `origin: workspace_template` — только если агент передал имя файла:
   - `bash head -c 200000 /workspace/Templates/{name}`
4. Max **5** bash read за вызов
5. **Не** использовать python для session VFS

## Выход

Markdown-секции:

```markdown
## Slot A: Эталон
…фрагмент…

## Slot B: Документ
…фрагмент…
```

Без дампа полного JSON в чат.

## Binding

Включать во **всех** агентах с `uiMode !== hidden` в `agent-profiles.json`.
