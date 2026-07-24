# Сравнение 27 — Work_18.30_29.06

**Метка:** `Work_18.30_29.06`  
**Статус:** approved snapshot  
**Снято:** 2026-06-29 18:30 (MSK)  
**Источник:** [`cases/compare-s27`](../../compare-s27/)

## Что зафиксировано

| Артефакт | Путь в снимке |
|----------|----------------|
| Instruction агента | [`agent/instruction`](agent/instruction) |
| Prod ids + bindings | [`agent/prod.json`](agent/prod.json) |
| 4 helper-навыка | [`skills/`](skills/) |
| Smoke (последний ok) | [`docs/smoke-download-last.json`](docs/smoke-download-last.json) |
| Тикет Ladcraft (tool result) | [`docs/ladcraft-ticket-tool-result-context.md`](docs/ladcraft-ticket-tool-result-context.md) |
| Handoff плагину (4B8BBCE) | [`docs/plugin-handoff-4B8BBCE.md`](docs/plugin-handoff-4B8BBCE.md) |

## Prod (на момент снимка)

| Сущность | id |
|----------|-----|
| Агент «Сравнение 27» | `s_eDSWr8EkRPfDsbgBJxa` |
| r7-report-actions-s27 | catalog `VXJisfG60TRXVBceXr0it` → installed `0HZzMZTKFcqVPD7xh85f3` |
| r7-export-compare-s27 | catalog `sBsa3PBF1N_Hq3IWZUFug` → installed `8AwLcWSN1SGo_U_ZKbIRy` |
| r7-save-compare-disk-s27 | catalog `xb_Sj95uLF1KvKPSDBA7y` → installed `hOtJN6c7YtL8GjP8hWCFL` |
| r7-docx-render | catalog `UHOuXEcDX0QYUuEXSuS8T` → installed `Wjh8b2THRGyflAIoKY8BH` |

## Архитектура (кратко)

- **START:** `bash ls` Templates, **без** activate helper skills
- **COMPARE:** 2× `bash head` (A 150k, B 200k) → markdown в чате; **без** `r7.task` / CompareReport
- **Критерии успеха B:** stdout содержит `r7-snapshot/v1`; не объявлять пустым из-за `ls`/`find`
- **ACTIONS:** helper skills → `r7.task` (вставить / скачать md / docx / диск)

Отличие от compare-r7 (`wvccZ9…`): markdown-first COMPARE; плагин берёт отчёт из текста чата.

## Восстановление на prod

### Instruction

```bash
node .cursor/skills/ladcraft-prod-publish/scripts/ladcraft_prod.js auth
node .cursor/skills/ladcraft-prod-publish/scripts/ladcraft_prod.js \
  agent-patch s_eDSWr8EkRPfDsbgBJxa \
  --instruction-file cases/approved-variants/compare-s27-work-18-30-29-06/agent/instruction
```

### Skills + bind (из живого кейса)

```bash
node cases/compare-s27/publish_and_bind.js
```

Или синхронизировать `cases/compare-s27/` из этого снимка (`agent/instruction`, `skills/*`) и запустить `publish_and_bind.js`.

### Smoke

```bash
node cases/compare-s27/smoke_download.js
```

Ожидание: `ok: true`, checks `compare_two_bash`, `compare_no_post_read`, `compare_head_has_snapshot`.

## Что отклонено

- `r7-disk-api` на агенте (удалён из allowed_app_ids)
- `doc-compare` / skill VFS read на COMPARE (ADR-001)
- CompareReport / `r7.task` на фазе COMPARE

## Связанные документы

- ADR: [`cases/compare-r7/docs/architecture-decisions.md`](../../compare-r7/docs/architecture-decisions.md)
- Живая разработка: [`cases/compare-s27/README.md`](../../compare-s27/README.md)
