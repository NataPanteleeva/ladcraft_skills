# Табличные агенты в плагине (Cell)

## Context family

| R7 редактор | `contextFamily` | VFS primary (profile `vfs`) |
|-------------|-----------------|-----------------------------|
| Word | `document` | `r7-snapshot/v1` JSON |
| Cell | `spreadsheet` | `.xlsx` (active sheet used range) |

Резолвер: [`src/transfer/context-family.ts`](../src/transfer/context-family.ts) — `resolveContextFamily(editorType)`.

Override (debug): `localStorage` `ladcraft_r7_context_family:{agentId}` = `document` | `spreadsheet`.

## Transfer profile

| Profile | Назначение |
|---------|------------|
| **`vfs`** (default) | Upload в session VFS |
| **`disk-ref`** (opt-in) | `r7-disk:{id}` без upload — серверные агенты |

Legacy localStorage `doc-compare` читается как `vfs`.

Табличные агенты используют тот же выбор профиля (Cell + vfs → workbook в session; Cell + disk-ref → только id на диске). Способы привязки vfs/disk-ref (allowlist, title, localStorage и кандидаты на будущее) — в [01-transfer-rules.md](01-transfer-rules.md) § «Варианты привязки профиля».

## Spreadsheet outbound

- [`ensureWorkbookContext`](../src/transfer/workbook-context.ts) — export Cell → xlsx → `/session/r7/{seg}/r7-….xlsx`
- Supplement в message: `workbook_path: /session/...`
- `mentioned.files[0]` — spreadsheet MIME

## Action bar (spreadsheet)

- **XLSX** — скачать файл агента из session VFS (path из ответа / tool `targetPath`)
- **Лист** — `AddSheet` + bulk `SetValue`; unlock по callback записи; viewport-nudge в фоне
- **Вставить** — матрица у активной ячейки; то же
- **Заменить** — очистить used range + bulk `SetValue` с A1; то же
- **CSV** — скачать csv выбранного deliverable
- **Запись** — только если в последнем ответе `r7.proposal` kind `cell_map`

Open-sheet mutate **без кнопок**: skill tools `sheet_replace` / `cell_format` → auto-apply (`sheet_replace_from_xlsx` / `cell_format` в `EDITOR_AUTO_APPLY_TYPES`).

Авто по фразе: «на новый лист» → **Лист**; «замени текущую таблицу» → **Заменить**. Канон: [DATA-FLOW-CANON.md](DATA-FLOW-CANON.md).

MD в Cell **нет** (остаётся только в Word).

Повтор кликов: как у Word (`allowRepeat`) — каждый раз берётся **последний** assistant reply с `/session/….xlsx`. Матрица кэшируется в памяти по пути файла.

Document (Word) — прежний набор: вставка, findings, MD, Word HTML.

## Viewport после `SetValue` (канон, проверено 2026-07-21)

После массовой записи ячеек R7 Cell часто **не перерисовывает** область, пока пользователь не проскроллит или не сменит лист.

### Что не работает

| Подход | Почему |
|--------|--------|
| Только `range.Select()` / `Activate()` в том же `callCommand`, что и `SetValue` | `Select` **не скроллит** viewport (лимит OnlyOffice/R7); плюс внешние функции плагина **недоступны** внутри `callCommand` (sandbox сериализует тело команды) |
| Возврат на предыдущую вкладку через `sheet.Activate()` после `AddSheet` | Нестабильно / лишние переключения; для обновления не обязателен при рабочем nudge |
| Отдельного `executeMethod("ScrollTo…")` | В API плагина **нет** |

### Рабочее решение (ladcraft-r7_new ≥ `0.6.61-sheet-unlock`)

Код: [`src/apply/editor-methods.ts`](../src/apply/editor-methods.ts) — `scheduleViewportNudge` / `nudgeCellViewportAfterWrite`.

**Завершение кнопки «Лист» / «Вставить» / «Заменить»** = success-callback **первого** `callCommand` (запись). UI снимает `actionBusy` сразу после него. Viewport-nudge — **fire-and-forget** (не ждём его callback). Watchdog в `main.ts` (~12 с) — только если Asc записал ячейки, но так и не вызвал callback записи; это не «нормальное ожидание».

1. **Первый** `callCommand` — только запись (`SetValue` bulk / по строкам) → **unlock UI**.
2. **Второй** `callCommand` (после callback записи, в фоне) — вся логика **inline** (без внешних замыканий плагина):
   - `homeRange.AutoFit(true, true)` на ячейке/диапазоне старта;
   - `sheet.GetFreezePanes().Unfreeze()` (как в макросах OO для сдвига вида);
   - `GetRange("A100").Select()` (fallback: `GetCells` 0-based);
   - `GetRange(home).Select()` — `home` = якорь вставки или `"A1"` для нового листа;
   - при наличии — `Api.RecalculateAllFormulas()`.

Паттерн:

```js
// 1) write — UI ждёт только этот callback
await callCommand(() => { /* SetValue matrix */ });

// 2) nudge — не блокирует unlock (schedule / race ≤2.5s)
Asc.scope = { homeAddr: "A1" /* или адрес курсора */ };
void callCommand(() => {
  const sheet = Api.GetActiveSheet();
  const home = String(Asc.scope.homeAddr || "A1");
  try { sheet.GetRange(home).AutoFit(true, true); } catch (e) {}
  try { sheet.GetFreezePanes().Unfreeze(); } catch (e) {}
  try { sheet.GetRange("A100").Select(); } catch (e) {}
  try { sheet.GetRange(home).Select(); } catch (e) {}
  try { Api.RecalculateAllFormulas(); } catch (e) {}
});
```

Индексация якоря вставки: `GetRow` / `GetCol` в R7 Cell — **1-based** (A1 → 1,1); не делать лишний `+1` при сборке A1.

## Deliverables без правок агента

[`resolveAgentDeliverables`](../src/apply/agent-deliverables.ts) / `resolveLatestAgentDeliverable` — пути `/session/….xlsx` в последнем ответе assistant.

## См. также

- [01-transfer-rules.md](01-transfer-rules.md)
- [03-apply-rules.md](03-apply-rules.md)
- [AGENT-PLUGIN-CONTRACT.md](AGENT-PLUGIN-CONTRACT.md)
- Общий handoff: [`cases/knowledge-base/r7-api-handoff/03-tables-cell.md`](../../knowledge-base/r7-api-handoff/03-tables-cell.md) § «Viewport после SetValue»
