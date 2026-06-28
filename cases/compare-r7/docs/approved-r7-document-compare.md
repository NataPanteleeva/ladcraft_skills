# Одобренный вариант: сравнение документов R7 и подгрузка списка шаблонов

**Статус:** справочный канон кейса `compare-r7` (2026-06-28, bash-first COMPARE).  
**Снимок в репозитории:** [`templates+compare`](../../approved-variants/r7-document-compare-templates-compare/) — рабочий approved-variant.  
**Решения и отвергнутые пути:** [`architecture-decisions.md`](architecture-decisions.md).  
**Применять:** при настройке агента/навыка, smoke, code review, публикации на prod.

Связанные документы:

| Документ | Назначение |
|----------|------------|
| [`architecture-decisions.md`](architecture-decisions.md) | ADR: почему bash-first, что пробовали и отклонили |
| [`cases/doc_compare/docs/r7-plugin-data-contract.md`](../../doc_compare/docs/r7-plugin-data-contract.md) | Upload snapshot, `mentioned.files` |
| [`agent/instruction`](../agent/instruction) | Живая instruction prod-агента |
| [`approved-variants/r7-document-compare-templates-compare/`](../../approved-variants/r7-document-compare-templates-compare/) | **Снимок** рабочего варианта `templates+compare` |
| [`skills/r7-compare-toolkit/SKILL.md`](../skills/r7-compare-toolkit/SKILL.md) | Промпт навыка (политика отчёта) |

Cursor: [`.cursor/rules/compare-r7-case.mdc`](../../../.cursor/rules/compare-r7-case.mdc) (после создания).

---

## Кратко (принято)

| Этап | Как (одобрено) | Как **не** делать |
|------|----------------|-------------------|
| **START** | `bash ls` Templates + `activate r7-compare-toolkit` (2 tool параллельно) → таблица | skill VFS listDir, `startup_compare`, чтение B |
| **COMPARE read** | **2× `bash head` параллельно** (A 150k, B 200k) → `body.text` из JSON | `load_compare_pair`, skill VFS session, python pipe |
| **COMPARE output** | LLM-отчёт + **`r7.task`** CompareReport | только markdown без `r7.task` |
| **EXPORT** | `r7-docx-render` → `r7_render_and_deliver_docx` | — |

Prod: агент **`wvccZ9WaZMDdCxfTyDGhh`**, навык **`r7-compare-toolkit`** (`TAJgJW37ybWIP5w7lmGzv`).  
Эталон скорости read: агент «Сравнение 27» (`s_eDSWr8EkRPfDsbgBJxa`) — bash-only ~6 с; у compare-r7 добавлен обязательный `r7.task`.

---

## Фаза START

**2 tool параллельно** (иначе R7 обрывает run):

1. `bash` → `ls -la /workspace/Templates/`
2. `skills activate r7-compare-toolkit`

Таблица: `| № | Название шаблона | Размер |` (размер из байт `ls` ÷ 1024 → КБ).

Сохрани `session_file` из `mentioned.files[0].file_name`. **Не читай B** на START.

**Запрет:** `startup_compare`, `load_compare_pair`, `find`, `cat`, `head` на B, `python`, повторный `ls`.

---

## Фаза COMPARE

Шаблон **уже выбран**. **Не** показывай список шаблонов. **Не** `ls` Templates.

### Read (1 batch, 2 bash параллельно)

```
head -c 150000 "/workspace/Templates/{шаблон}.md"
head -c 200000 "<session_file из mentioned.files>"
```

Альтернатива A: `cat "/workspace/Templates/{шаблон}.md" | head -c 150000`

Из вывода B извлеки **`body.text`** (`r7-snapshot/v1`; текст обычно в первых 200k байт JSON).

### Analyze + deliver (0 tools)

- LLM сравнивает A и `body.text` по смыслу.
- Чат: резюме + до 10 критичных + «**Расхождений: N**».
- **`r7.task`** (не `json`):

```r7.task
[{"type":"deliver_inline","data":{"fileName":"compare-report.json","mimeType":"application/json","encoding":"utf8","content":"<CompareReport одной строкой>","actions":[]}}]
```

CompareReport: `schema: doc-compare/v1`, `chatMarkdown`, `sections` — все расхождения.

**Запрет:** `load_compare_pair`, `prepare_compare`, `read_r7_snapshot_text`, `python3`, `cat | python`, повторные read.

---

## Фаза EXPORT

```
skills activate r7-docx-render
r7_render_and_deliver_docx({ "report": <CompareReport из r7.task> })
```

---

## Чеклист

- [ ] START: bash `ls` + activate, таблица, B не читался
- [ ] COMPARE: 2× head A+B в одном batch, затем отчёт без tools
- [ ] Нет `load_compare_pair` / python / skill read session
- [ ] В ответе есть `r7.task` с `doc-compare/v1`
- [ ] Read phase &lt; 15 с, полный COMPARE &lt; 2 мин

---

## Публикация

```bash
cd cases/compare-r7
node build_payload.js
node publish_skill_update.js TAJgJW37ybWIP5w7lmGzv payloads/r7-compare-toolkit.json
node ../../.cursor/skills/ladcraft-prod-publish/scripts/ladcraft_prod.js \
  agent-patch wvccZ9WaZMDdCxfTyDGhh --instruction-file agent/instruction
```

---

*Обновлено: 2026-06-28 — bash-first COMPARE (ADR-001); подтверждено сессией «Сравнение 27».*
