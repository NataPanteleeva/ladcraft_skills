# compare-r7 — альтернативный стек (LLM-сравнение через doc-compare)

> **Не используется** prod-агентом `mwCvjRFNfMsFInbLjrrdr`. Тот агент работает по сценарию [`cases/doc_compare/`](../doc_compare/) (`doc_compare_toolkit`, `temp.md`).

Prod-агент сравнения документов (исходный сценарий): см. [`cases/doc_compare/README.md`](../doc_compare/README.md).

R7 compare-агент: **`Tzr2xtBAyU0_jR1az_a8S`** («R7: сравнение документов»).

---

## Стек навыков

| Навык | catalog id | installed id | Примечание |
|-------|------------|--------------|------------|
| r7-compare-toolkit | `6EOkDFcZIgJD4ZeeG8sXF` | `WsZ_m5mPNzJ3YQ6wP3IUw` | старт + read_r7 (v3.0.0) |
| doc-compare | `kUY4vqRPkE2PCWhZQ7z6b` | `zKn8cwYiDRubz4g0Z3PAP` | **LLM** смысловое сравнение (v1.4.2) |
| r7-docx-render | `TRqznAiE55l_vthY5yw_5` | `P47xcD15S15TToH6AIIXh` | атомарный export: `r7_render_and_deliver_docx` |
| ~~r7-compare-toolkit (old)~~ | `OS2pO6ddEsm18h9ZCPJKS` | — | **disabled** binding |
| ~~doc-compare (old)~~ | `XvLg5pmJ8h5CXsmvvK97d` | — | **disabled** binding |
| ~~r7-export-compare~~ | `3JXg6KuzPnE0XCpaTL1YZ` | **отключить** на compare-агенте (legacy двухшаговый deliver) |
| ~~r7-export~~ | `kFVwfGVl2rcHINNduB2yq` | **не** привязывать к compare-агенту (юр.аудит и др.) |

**Не привязывать** `doc_compare_toolkit` (`iYjsBqLRzhZtfGujQFPO6`) к compare-агенту.

## Публикация

```bash
cd cases/compare-r7
node build_payload.js

# новые навыки (после удаления на платформе) — skill-create:
node ../../.cursor/skills/ladcraft-prod-publish/scripts/ladcraft_prod.js skill-create payloads/r7-compare-toolkit.json
node ../../.cursor/skills/ladcraft-prod-publish/scripts/ladcraft_prod.js skill-create payloads/doc-compare.json

# обновление существующих:
node publish_skill_update.js 6EOkDFcZIgJD4ZeeG8sXF payloads/r7-compare-toolkit.json
node publish_skill_update.js kUY4vqRPkE2PCWhZQ7z6b payloads/doc-compare.json
node publish_skill_update.js TRqznAiE55l_vthY5yw_5 payloads/r7-docx-render.json

node ../../.cursor/skills/ladcraft-prod-publish/scripts/ladcraft_prod.js agent-patch Tzr2xtBAyU0_jR1az_a8S --instruction-file agent/instruction
node ../../.cursor/skills/ladcraft-prod-publish/scripts/ladcraft_prod.js agent-bind Tzr2xtBAyU0_jR1az_a8S 6EOkDFcZIgJD4ZeeG8sXF --install
node ../../.cursor/skills/ladcraft-prod-publish/scripts/ladcraft_prod.js agent-bind Tzr2xtBAyU0_jR1az_a8S kUY4vqRPkE2PCWhZQ7z6b --install
node ../../.cursor/skills/ladcraft-prod-publish/scripts/ladcraft_prod.js agent-bind Tzr2xtBAyU0_jR1az_a8S TRqznAiE55l_vthY5yw_5 --install
node ../../.cursor/skills/ladcraft-prod-publish/scripts/ladcraft_prod.js agent-bind Tzr2xtBAyU0_jR1az_a8S 3JXg6KuzPnE0XCpaTL1YZ --disabled
node ../../.cursor/skills/ladcraft-prod-publish/scripts/ladcraft_prod.js agent-patch Tzr2xtBAyU0_jR1az_a8S --instruction-file agent/instruction
```

## Smoke

```bash
node smoke_first_turn.js   # первый ход: activate + startup_compare, без bash, <60с
node smoke_test.js         # START + compare (doc-compare LLM) + export
node test_compare_local.js # локальный unit-test парсера (без API)
```

Headless API smoke не гарантирует `deliver_file` в ответе — session VFS для skill tools может быть недоступен вне R7. Полный export проверяйте в плагине R7.

## Плагин R7 (ladcraft-r7)

Контракт: [`cases/doc_compare/docs/r7-plugin-data-contract.md`](../doc_compare/docs/r7-plugin-data-contract.md).

- `sync: true` на upload **до** первого сообщения
- `mentioned.files[0].file_name` = `/session/r7/r7-{key}.json`
- Title: `R7: word:{docKey}::agent:{agentId}`

