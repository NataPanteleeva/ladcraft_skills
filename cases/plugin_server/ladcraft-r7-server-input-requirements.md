# Ladcraft R7 Server — контракт передачи данных

> Плагин: `plugins/ladcraft_r7_server/`

## Слои

| Слой | Содержимое |
|------|------------|
| Профиль агента | `profiles/agent-profiles.json` — слоты, uiMode |
| HTTP message | `content` + `[R7-DOC-BUNDLE]` + `mentioned.files[]` |
| Session VFS | snapshot `r7-snapshot/v1`, `scope=session`, `sync:true` |
| User VFS | кэш вкладок для cross-tab mount |

## r7-doc-bundle/v1

```json
{
  "schema": "r7-doc-bundle/v1",
  "profileId": "multi-open-compare",
  "agentId": "...",
  "applyTarget": { "slotId": "B", "origin": "host" },
  "slots": [
    {
      "slotId": "A",
      "label": "Эталон",
      "origin": "open_tab",
      "path": "/session/r7/r7-word_….json",
      "file_id": "...",
      "title": "Договор А.docx"
    }
  ]
}
```

## Навык r7-doc-read

Binding у всех multi-doc агентов. Читает слоты bundle bash `head` (session ≤ 120000, workspace ≤ 200000).

См. `knowledge-base/skills Ladkraft/r7-doc-read/SKILL.md`.

**Настройка агентов на Ladcraft:** [`ladcraft-r7-server-agent-handoff.md`](ladcraft-r7-server-agent-handoff.md).
