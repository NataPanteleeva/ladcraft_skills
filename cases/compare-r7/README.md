# compare-r7 — R7: сравнение документов с шаблонами Templates

> **ADR:** [`docs/architecture-decisions.md`](docs/architecture-decisions.md) — почему bash-first, отвергнутые варианты.  
> **Рабочий снимок:** [`templates+compare`](../approved-variants/r7-document-compare-templates-compare/) — approved-variant в репозитории.

Отдельный legacy-стек без R7: [`cases/doc_compare/`](../doc_compare/) (`doc_compare_toolkit`, агент `mwCvjRFNfMsFInbLjrrdr`).

---

## Prod (ladcraft.ru)

| Сущность | id | Примечание |
|----------|-----|------------|
| Агент «R7: сравнение документов» | `wvccZ9WaZMDdCxfTyDGhh` | instruction: `agent/instruction` |
| Навык r7-compare-toolkit | `TAJgJW37ybWIP5w7lmGzv` | instruction-only (политика отчёта) |
| installed copy | `rMT5ftorab_GDqYRyxO5M` | binding на агенте |

Синхронизация id: `agent/.from-server.json`.

**В плагине R7** выберите агент `wvccZ9WaZMDdCxfTyDGhh`.

---

## Стек

| Навык | Роль |
|-------|------|
| **r7-compare-toolkit** | Политика COMPARE + `r7.task`; read через **agent bash head** |
| **r7-docx-render** | EXPORT: `r7_render_and_deliver_docx` (привязать при необходимости) |

START (список шаблонов) выполняет **агент через bash**, не skill-tool — см. [approved doc](docs/approved-r7-document-compare.md).

---

## Публикация

```bash
cd cases/compare-r7
node build_payload.js

# обновление навыка:
node publish_skill_update.js TAJgJW37ybWIP5w7lmGzv payloads/r7-compare-toolkit.json

# instruction агента:
node ../../.cursor/skills/ladcraft-prod-publish/scripts/ladcraft_prod.js \
  agent-patch wvccZ9WaZMDdCxfTyDGhh --instruction-file agent/instruction

# привязка (если новый агент / навык):
node ../../.cursor/skills/ladcraft-prod-publish/scripts/ladcraft_prod.js \
  agent-bind wvccZ9WaZMDdCxfTyDGhh TAJgJW37ybWIP5w7lmGzv --install
```

---

## Smoke

```bash
node smoke_first_turn.js   # 1-й ход: bash ls Templates + activate (см. approved doc)
node smoke_test.js         # START + compare + export
node test_compare_local.js # unit-test парсера (без API)
```

Переменная `LC_AGENT_ID` — override agent id (по умолчанию в скриптах может быть устаревшей; см. таблицу prod выше).

Полный export с `deliver_file` проверяйте в плагине R7.

---

## Плагин R7

Контракт upload / `mentioned.files`: [`cases/doc_compare/docs/r7-plugin-data-contract.md`](../doc_compare/docs/r7-plugin-data-contract.md).

- `sync: true` на upload **до** первого сообщения
- `mentioned.files[0].file_name` = `/session/r7/r7-{key}.json`
- Title: `R7: word:{docKey}::agent:{agentId}`
