# Future: server agents (disk-ref) for LCA / excel

Отложено относительно AG-UI-плагина. Плагин `ladcraft-r7_agui` уже умеет outbound **vfs** и **disk-ref** (как `_new`); не хватает отдельных agent/skills, которые **читают** документ по `document_id`.

## Зачем disk-ref

- Плагин **не** заливает исходный файл в session VFS — только `r7-disk:{id}` + supplement.
- Обходит лимиты **upload snapshot → VFS**.
- На сервере document id **всегда** есть (решение продукта).
- Сохранение правок v1: Asc в открытый редактор → штатный save редактора (не Disk REST write-back из плагина).

## Контракт outbound (плагин → агент)

```json
{
  "file_id": "r7-disk:12345",
  "file_name": "Договор.docx",
  "mime_type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
}
```

Supplement в `content`:

```text
[Контекст R7: диск]
document_id: 12345
file_name: Договор.docx
```

Канон: [`cases/p7-compare/docs/r7-disk-ref-contract.md`](../../../p7-compare/docs/r7-disk-ref-contract.md)  
Код: [`../src/transfer/disk-ref.ts`](../src/transfer/disk-ref.ts)  
Контракт агента: [`../docs/AGENT-PLUGIN-CONTRACT.md`](../docs/AGENT-PLUGIN-CONTRACT.md) §2.4

## Что сделать на следующем этапе

| Агент | Desktop (уже есть) | Server (сделать) |
|-------|--------------------|------------------|
| LCA | VFS snapshot + proposal | Новый agent_id: disk-ref profile; skills читают через Disk (`R7_DISK_*`), тот же `r7.proposal` UX |
| excel | workbook VFS + `userReply`/`Файл:` | Новый agent_id: disk-ref; workbook по id; тот же deliverable UX |

Рекомендация: **отдельные agent_id**, не dual-mode instruction.

Env для server-skills: `R7_DISK_BASE_URL`, `R7_DISK_LOGIN`, `R7_DISK_PASSWORD` — см. [`cases/r7-disk-api/`](../../../r7-disk-api/).

Пример агента на disk-ref: `cases/p7-compare/`, `cases/r7-compare-docs/`, analytics/gost34 с `r7-disk:`.

## Ограничения (не «безлимит»)

- Исходник не в VFS, но skill **качает** с Диска → лимиты Disk REST / памяти / LLM.
- У compare-disk fetch текста был кап ~200 000 байт — не копировать слепо.
- Если skill пишет результат в session VFS — лимиты VFS снова на **результате**.

## Не в scope этого этапа

- «Окно Ladcraft» / multi-agent catalog / AG-UI surfaces
- Disk REST save из плагина
- Правки prod `ladcraft-r7_new`

## Spike AG-UI (зафиксировано)

См. [`SPIKE-AGUI.md`](SPIKE-AGUI.md): capabilities OK; run требует nanoid ids; history после run заполняется.
