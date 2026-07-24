# Архитектура ladcraft-r7_new (LCA)

Форк [`ladcraft-r7_btn_stream`](../ladcraft-r7_btn_stream/) с контрактом **tool_calls-first** и feedback **`r7.event`**.

```mermaid
flowchart LR
  subgraph part1 [Block1_Transfer]
    R7[R7 editor] --> Snap[snapshot v1]
    Snap --> VFS[session VFS]
    VFS --> Out[OutboundTransfer]
  end
  subgraph part2 [Block2_Chat]
    Out --> POST[POST message]
    POST --> Hist[history SSE or poll]
    Hist --> UI[chat UI]
  end
  subgraph part3 [Block3_Apply]
    TC[tool_calls primary] --> Apply[R7 API]
    Fence[r7.task fallback] --> Apply
    Apply --> Ev[r7.event quiet POST]
    Ev --> POST
  end
  part1 --> part2
  part2 --> part3
```

## Контракт между блоками

**Блок 1 → 2:** `OutboundTransfer` (`src/transfer/types.ts`)

**Блок 2 → 3:** `HistoryMessage` с `tool_calls` + text (fence fallback)

**Блок 3 → 2:** quiet `sendMessage` с ```r7.event``` (без snapshot remount, без optimistic user bubble)

## Каталоги

| Блок | Путь | Документация |
|------|------|--------------|
| 1 | `src/transfer/` | [01-transfer-rules.md](01-transfer-rules.md) |
| 2 | `src/main.ts`, `src/ui/`, `src/eai/` | [02-chat-rules.md](02-chat-rules.md) |
| 3 | `src/apply/` | [03-apply-rules.md](03-apply-rules.md), [04-skill-output-contract.md](04-skill-output-contract.md) |

## Агент

Целевой агент: [`cases/LCA/`](../../LCA/) (лингвистическая проверка).
