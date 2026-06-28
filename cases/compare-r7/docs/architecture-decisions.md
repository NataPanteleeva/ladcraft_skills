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
| [`cases/compare-r7_v2/`](../../compare-r7_v2/) | Экспериментальный форк; не канон prod |

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
