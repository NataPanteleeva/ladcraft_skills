# AGENTS.md — ladcraft-r7



**Статус передачи (doc-compare):** рабочий вариант (проверено) — см. KB `ladcraft-r7-doc-compare-transfer.md`.



Инструкции для AI при правках **этого плагина**.



## Сначала прочитай



1. [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — три блока

2. Правила блока, который меняешь:

   - Передача данных → [docs/01-transfer-rules.md](docs/01-transfer-rules.md)

   - Чат → [docs/02-chat-rules.md](docs/02-chat-rules.md)

   - Вставка → [docs/03-apply-rules.md](docs/03-apply-rules.md)



## Границы



| Задача | Менять | Не трогать |

|--------|--------|------------|

| VFS, snapshot, `mentioned.files` | `src/transfer/` | `src/ui/`, task-runner |

| Чат, poll, виджеты | `src/main.ts`, `src/ui/`, `session.ts` | `src/transfer/` (кроме вызова `prepareOutbound`) |

| r7.task, вставка | `src/apply/` (будущее) | `src/transfer/` |



## После изменения контракта ч.1



Обновить `docs/01-transfer-rules.md` и KB `ladcraft-r7-plugin-input-requirements.md`.



## Entry point ч.1



```typescript

import { prepareOutbound } from "./transfer";

```



Не добавлять VFS upload в `main.ts` — только через `prepareOutbound` (с `sessionId`).


