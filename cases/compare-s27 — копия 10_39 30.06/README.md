# compare-s27 — агент «Сравнение 27»

Отдельный кейс для эталонного агента сравнения R7. **Не путать** с [`cases/compare-r7/`](../compare-r7/) (агент «R7: сравнение документов», `wvccZ9WaZMDdCxfTyDGhh`).

## Prod

| Сущность | id |
|----------|-----|
| Агент «Сравнение 27» | `s_eDSWr8EkRPfDsbgBJxa` |

Instruction: [`agent/instruction`](agent/instruction). Синхронизация id: [`agent/.from-server.json`](agent/.from-server.json).

## Архитектура (отличие от compare-r7)

| | Сравнение 27 | compare-r7 (`wvccZ9…`) |
|---|--------------|------------------------|
| COMPARE output | **markdown в чате** | markdown + `r7.task` CompareReport |
| `r7.task` на COMPARE | **нет** | да (`deliver_inline` compare-report.json) |
| `r7.task` на ACTIONS | через helper-навыки | через toolkit / export |

Плагин R7 распознаёт отчёт по тексту чата (`isComparisonReport`); CompareReport на COMPARE **не обязателен**. `r7.task` генерируется только при «вставить» / «скачать» / docx через helper-навыки.

Transport COMPARE: **2× `bash head`** (A 150k, B 200k), 0 tool после batch — см. [`compare-r7/docs/architecture-decisions.md`](../compare-r7/docs/architecture-decisions.md) ADR-001/006.

## Локальные helper-навыки (для тонкого агента)

- [`r7-report-actions/`](r7-report-actions/) — формирует `r7.task` для:
  - вставки отчёта в документ (`paste_text`);
  - скачивания markdown (`deliver_inline`).
- [`r7-export-compare/`](r7-export-compare/) — доставляет готовый DOCX:
  - upload в session VFS;
  - возврат `deliver_file` c реальным `fileId`.
- [`r7-save-compare-disk-s27/`](r7-save-compare-disk-s27/) — сохраняет отчёт на Р7-Диск:
  - login по `R7_DISK_*` из установки навыка;
  - папка `CompareResults` (создать или найти);
  - DOCX с markdown-отчётом.

Эти навыки нужны, чтобы не раздувать `agent/instruction` и повысить стабильность на маленькой модели.

## Публикация skills + instruction

```bash
node cases/compare-s27/publish_and_bind.js
```

Или только instruction:

```bash
node ../../.cursor/skills/ladcraft-prod-publish/scripts/ladcraft_prod.js \
  agent-patch s_eDSWr8EkRPfDsbgBJxa --instruction-file agent/instruction
```

Перед первым сохранением на диск: при установке `r7-save-compare-disk-s27` задайте `R7_DISK_BASE_URL`, `R7_DISK_LOGIN`, `R7_DISK_PASSWORD` (API-хост `cddisk.*`, не `admin.*`).

## Smoke

- [`smoke_download.js`](smoke_download.js) — COMPARE (2× head, no post-read, `r7-snapshot/v1` в result) + скачивание md.
- [`smoke_disk_save.js`](smoke_disk_save.js) — сохранение отчёта на Р7-Диск (требует настроенный `R7_DISK_*` на prod).

Инциденты / handoff:

- Плагин не виноват (4B8BBCE): [`cases/cursor_exchange/ladcraft-r7-4B8BBCE-plugin-not-at-fault.md`](../cursor_exchange/ladcraft-r7-4B8BBCE-plugin-not-at-fault.md)
- Тикет Ladcraft (tool result truncation): [`docs/ladcraft-ticket-tool-result-context.md`](docs/ladcraft-ticket-tool-result-context.md)

**Одобренный снимок:** [`cases/approved-variants/compare-s27-work-18-30-29-06`](../approved-variants/compare-s27-work-18-30-29-06/) — метка `Work_18.30_29.06`.
