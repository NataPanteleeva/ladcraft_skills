# Architecture decisions: compare-r7 (R7 document compare)

**Статус:** принято (2026-06-28).  
**Канон исполнения:** [`approved-r7-document-compare.md`](approved-r7-document-compare.md).  
**Кейс:** `cases/compare-r7/` — агент `wvccZ9WaZMDdCxfTyDGhh`, навык `r7-compare-toolkit`.

---

## ADR-001: COMPARE read через agent bash `head`, не skill VFS

### Контекст

Сравнение двух документов: A (шаблон в workspace) и B (r7-snapshot в session VFS). Нужен быстрый и предсказуемый read перед LLM-отчётом.

### Решение (принято)

На **COMPARE** — **1 batch, 2× bash параллельно** у host-агента:

```bash
head -c 150000 "/workspace/Templates/{шаблон}.md"
head -c 200000 "{session_file из mentioned.files}"
```

Затем **0 tools** — LLM извлекает `body.text` из JSON-фрагмента B, сравнивает с A, отдаёт чат + `r7.task` CompareReport.

Навык `r7-compare-toolkit` на START **activate** только для **политики отчёта** (формат, `r7.task`, типы расхождений). **Tools в mcp_spec не публикуем** (instruction-only skill).

### Почему именно так (prod-доказательства)

| Наблюдение | Сессия / дата |
|------------|----------------|
| `bash ls` Templates на START — секунды | 16-26-08, множество smoke |
| `bash head` A+B — OK, `body.text` в первых 5k JSON | 15-43-38; **«Сравнение 27»** `sSq4sMISgdtM3RwQW9Hrm` 16-46-07 (~6 с) |
| `python3` pipe на session — sandbox reject | 16-37-34 (wvccZ9); 16-46-07 (Сравнение 27) |
| `load_compare_pair` / skill VFS на `/session/r7/` — **~600 с** `Applications.Run TIMEOUT` | 16-27-21 → 16-37-27 (`JGb4lRRCfRVxcjNpBj8yP`) |
| JS timeout 8–15 с в tool **не срабатывает** — платформа убивает весь skill-run | тот же инцидент |
| После TIMEOUT агент ушёл в `cat \| python3` — sandbox reject | 16-37-34 |

**Вывод:** read B через skill sandbox на session path **неработоспособен** на prod; agent bash на том же path **работает**.

### Отвергнутые варианты

| # | Вариант | Почему отклонён |
|---|---------|-----------------|
| R1 | **`prepare_compare`** / **`read_r7_snapshot_text`** (skill VFS) | Зависания на `/session/r7/`; тот же класс, что `load_compare_pair` |
| R2 | **`load_compare_pair`** как единственный tool на COMPARE | Prod TIMEOUT ~10 мин; не отдаёт `ok:false` с hint, а `TOOL_ERROR` |
| R3 | **Fail-fast tool** (8 с) + bash fallback | Platform timeout 600 с; in-skill `Promise.race` не прерывает Applications.Run |
| R4 | **Гибрид tool:** A skill VFS, B только hint | 2 round-trip (tool → bash); медленнее чем R5 |
| R5 | **Fail-fast tool без VFS на B** (сразу hint) | Лишний Applications.Run; по сути обёртка над bash |
| R6 | **`cat`** полного шаблона / snapshot | Слишком много токенов; `cat` B — сырой JSON в контекст |
| R7 | **`python3` pipe** на session VFS | Sandbox: stdin/pipe на VFS запрещён (16-37-34) |
| R8 | **Плагин кладёт `body.txt` sidecar** | Правильно долгосрочно, но требует изменений ladcraft-r7; вне scope кейса |
| R9 | **Кэш `.compare/*.json`** для шаблонов | A читается head за &lt;1 с; не решает проблему B |
| R10 | **START через `startup_compare` / listDir** | Зависания, пустой список, обрыв run (fast-templates ADR) |

### Условие пересмотра

Вернуть single-tool `load_compare_pair`, когда на prod skill VFS стабильно читает `/session/r7/*.json` за &lt;15 с (smoke в `smoke_test.js`).

Код tool остаётся в `skills/r7-compare-toolkit/scripts/load_compare_pair.js` (**не публикуется**).

---

## ADR-002: START — bash `ls` + activate (без skill list)

Принято ранее (fast-templates). Skill VFS `listDir` на START ненадёжен; R7 требует **2 tool** в первом batch.

См. [`approved-variants/r7-document-compare-fast-templates/`](../../approved-variants/r7-document-compare-fast-templates/).

---

## ADR-003: Два канала выхода COMPARE

| Канал | Потребитель | Содержимое |
|-------|-------------|------------|
| `content` | Пользователь | Краткий markdown (до 10 критичных в таблице) |
| `r7.task` → `deliver_inline` | Плагин R7 | CompareReport `doc-compare/v1` (все `sections`) |

Не использовать блок ` ```json ` в чате.

---

## Где смотреть при работе с кейсом

### Обязательно (compare-r7)

1. [`docs/approved-r7-document-compare.md`](approved-r7-document-compare.md) — алгоритм фаз
2. **Этот файл** — почему выбран путь и что уже пробовали
3. [`agent/instruction`](../agent/instruction) — prod instruction
4. [`skills/r7-compare-toolkit/SKILL.md`](../skills/r7-compare-toolkit/SKILL.md) — промпт навыка
5. [`cases/doc_compare/docs/r7-plugin-data-contract.md`](../../doc_compare/docs/r7-plugin-data-contract.md) — upload, `mentioned.files`, snapshot

### Смежные кейсы (другие подходы — не смешивать)

| Путь | Когда смотреть |
|------|----------------|
| [`cases/doc_compare/`](../../doc_compare/) | Legacy агент без R7 (`doc_compare_toolkit`, `read_r7_snapshot_text`) |
| [`cases/common_skills/doc-compare/`](../../common_skills/doc-compare/) | Общий skill doc-compare, схема CompareReport |
| [`cases/approved-variants/r7-document-compare-templates-compare/`](../../approved-variants/r7-document-compare-templates-compare/) | **Рабочий снимок** `templates+compare` (bash START + bash COMPARE + r7.task) |
| [`cases/approved-variants/r7-document-compare-fast-templates/`](../../approved-variants/r7-document-compare-fast-templates/) | История только START (bash ls); COMPARE устарел |
| [`cases/cursor_exchange/ladcraft-r7-docx-scenario-a-handoff.md`](../../cursor_exchange/ladcraft-r7-docx-scenario-a-handoff.md) | EXPORT docx, `r7.task` deliver_file |
| [`cases/compare-r7_v2/`](../compare-r7_v2/) | **v2 prod** — ADR-005; агент `tc04UdOHJpv0YYKJjLbF8` |

### Cursor rule

При правках кейса применяется [`.cursor/rules/compare-r7-case.mdc`](../../../.cursor/rules/compare-r7-case.mdc).

---

## ADR-004: Отличия compare-r7 от «Сравнение 27»

Агент `s_eDSWr8EkRPfDsbgBJxa` — референс **скорости** bash read, не полный продукт:

| | Сравнение 27 | compare-r7 (канон) |
|---|--------------|-------------------|
| Skills | нет | `activate r7-compare-toolkit` на START |
| COMPARE read | 3 bash; B с START peek, python fail | **2× head** A+B на COMPARE |
| `r7.task` | нет | **обязателен** |
| START | 3 tool (ls + 2× read B) | 2 tool (ls + activate), B не читать |

---

*Последнее обновление: 2026-06-28 — ADR-001 bash-first; ADR-004 Сравнение 27.*

---

## ADR-005: compare-r7 v2 — templates+compare START + LLM + docx

**Статус:** принято (2026-06-29), уточнено 2026-06-29 (отозван peek B на START).  
**Кейс:** `cases/compare-r7_v2/` — агент `tc04UdOHJpv0YYKJjLbF8`.

### Контекст

Prod-агент `wvccZ9WaZMDdCxfTyDGhh` дрейфовал от канона. Первая версия v2 с **peek B на START** (3 tool) давала ложные «snapshot не найден»: `bash head` на START успешен, агент уходил во 2-й batch (`python3`/`find`) и ошибался (сессия tc04UdO).

### Решение

| Фаза | v2 |
|------|-----|
| **START** | 2 tool: `bash ls` Templates + `activate r7-compare-toolkit-v2`; **B не читать**; 0 tool после batch |
| **COMPARE** | 2× `bash head` A+B → LLM semantic → `r7.task` CompareReport |
| **EXPORT** | `r7-docx-render-v2` → `r7_render_and_deliver_docx` |
| **Навыки toolkit/doc-compare** | instruction-only (`tools: []`) |
| **compare_documents** | только локально (`test_compare_local.js`), не prod |

### Отличие от «Сравнение 27»

| | S27 | v2 |
|---|-----|-----|
| Список шаблонов | `bash ls` | **то же** |
| Read B на START | 2× peek | **нет** (канон templates+compare) |
| `r7.task` / docx | нет | **да** |

### Эталон

- START list: S27 + [`templates+compare`](../approved-variants/r7-document-compare-templates-compare/)
- COMPARE read: bash head ~6 с (ADR-001)
- Снимок: [`approved-variants/r7-document-compare-v2/`](../approved-variants/r7-document-compare-v2/)

### Отозвано

- Peek B на START (`head -c 8000` на первом сообщении) — ложные срабатывания, лишние tool-раунды.

---

## ADR-006: Transport фиксирован, policy настраивается в doc-compare-v2

**Статус:** принято (2026-06-29).  
**Кейс:** `cases/compare-r7_v2/` — агент `tc04UdOHJpv0YYKJjLbF8`.

### Контекст

На COMPARE агент после успешных `bash head` A+B уходил во **2-й batch** post-read диагностики (`wc`, `cat`, `python3`, `find`, `ls .tool_results`). `python3` на `/session/r7/...` падает в sandbox → ложное «snapshot не найден», хотя первый `head` вернул `r7-snapshot/v1` (сессии tc04UdO).

### Решение

Разделить ответственность на два слоя:

| Слой | Где | Содержимое |
|------|-----|------------|
| **Transport** | `compare-r7_v2/agent/instruction`, `r7-compare-toolkit-v2` SKILL | Фазы START/COMPARE/EXPORT; ровно 2 tool на START; ровно 2× `bash head` на COMPARE; **0 tool после batch**; жёсткий список запретов post-read |
| **Policy** | `doc-compare-v2` SKILL, раздел **«Policy по умолчанию»** | Смысл сравнения: ignore-правила, приоритет секций, severity, глубина вывода — **единственный редактируемый профиль** |

**Transport на prod не тюним** через новые tool или fallback-ветки. Изменение логики сравнения (что игнорировать, что считать критичным) — только правка `doc-compare-v2/SKILL.md`.

### COMPARE transport (инварианты)

1. **1 batch** — 2× `bash head` параллельно, затем LLM-отчёт.
2. **Запрещён 2-й batch** на фазе COMPARE.
3. **Запрет post-read:** `wc`, `cat` на B (кроме `cat … \| head` только для A с пробелами в пути), `python`/`python3`, `find`, `ls` session / `.tool_results`, повторный `head`/`cat` на B, `jq`, skill tools.
4. **Парсинг B:** если stdout `head` содержит `"r7-snapshot/v1"` или `"body"` — read успешен; извлечь `body.text`; не трактовать обрезку/stderr как «файл отсутствует».
5. **Ошибка read:** одно сообщение пользователю + перезапуск из R7; **без** fallback-tool.

### Prod-доказательства

| Наблюдение | Сессия |
|------------|--------|
| 2× head OK, затем python3/wc → false «не найден» | tc04UdO, `sub_roznich.md` |
| S27: меньше веток после read — стабильнее | `s_eDSWr8EkRPfDsbgBJxa` (ADR-004) |

### Условие пересмотра

Вернуть post-read диагностику только если появится отдельный **надёжный** skill tool read B за &lt;15 с (см. ADR-001) — до тех пор transport остаётся bash-only.

*Последнее обновление: 2026-06-29 — ADR-006 transport vs policy.*

---

## ADR-007: Monolith skill + slim CompareReport

**Статус:** принято (2026-06-29).  
**Кейс:** `cases/compare-r7_v2/` — агент `tc04UdOHJpv0YYKJjLbF8`.

### Контекст

Три bound skills (toolkit, doc-compare, docx-render) дублировали transport/policy в контексте; `chatMarkdown` в `r7.task` раздувал ответ → context compaction → EXPORT не находил report (сессия `6b6ac4`).

### Решение

| Было | Стало |
|------|--------|
| 3 skills, 2× activate (START + EXPORT) | **1 skill** `doc-compare-v2` (monolith в `skills/r7-document-compare/`) |
| `chatMarkdown` в JSON | **slim** CompareReport: `schema` + `meta` + `sections` only |
| EXPORT: activate + render + bash fallback | **1 tool** `r7_render_and_deliver_docx({ reportPath })` |
| Agent instruction ~120 строк | **~50 строк** router + skill body |

Плагин и docx-tool собирают markdown из `sections` (`compareReportToMarkdown`).

Откат: [`approved-variants/r7-document-compare-v2-3skills/`](../../approved-variants/r7-document-compare-v2-3skills/).

---

## ADR-008: Persist report + EXPORT transport

**Статус:** принято (2026-06-29).

### Решение

**COMPARE** (уточнение ADR-006):

1. Batch 1: 2× `bash head` (без изменений).
2. Batch 2: **1×** `r7_persist_compare_report({ report })` → `/session/compare/latest.json`.
3. Финальный текст + slim `r7.task` (0 tool после persist).

**EXPORT:**

- Триггер docx: `скачать docx`, `Word`, `docx` — **не** голое «скачать».
- **1 tool:** `r7_render_and_deliver_docx({ reportPath: "/session/compare/latest.json" })`.
- **Запрет:** bash, `.tool_results`, `skills activate`, парсинг history.

*Последнее обновление: 2026-06-29 — ADR-007 monolith; ADR-008 persist + EXPORT.*
