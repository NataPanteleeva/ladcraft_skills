# Ladcraft ticket: tool result в history ≠ контекст модели (COMPARE R7)

**Тип:** platform / agent runtime  
**Приоритет:** high (ложные отказы «snapshot пуст» при рабочем VFS)  
**Кейс:** `cases/compare-s27/`, агент `s_eDSWr8EkRPfDsbgBJxa`  
**Дата инцидента:** 2026-06-29

---

## Симптом

На фазе COMPARE агент сообщает пользователю, что snapshot недоступен / нечитаем, хотя в экспорте чата `toolCalls[].result` для `bash head` на `/session/r7/*.json` содержит полный фрагмент с `r7-snapshot/v1` и непустым `body.text`.

Пользователь видит ложный отказ; плагин R7 и upload VFS при этом могут быть исправны.

---

## Воспроизведение (prod)

| Поле | Значение |
|------|----------|
| session_id | `A0EbkyVT53nor_OvJEPnM` |
| chat export | `agent-chat-history-R7-word-4B8BBCE363542976A99F82CA8D4F1BD2233-2026-06-29T15-18-37-401Z.json` |
| agent_id | `s_eDSWr8EkRPfDsbgBJxa` |
| user turns | `привет` → `sub_roznich.md` |

### Шаги

1. R7 plugin upload snapshot (~464 КБ) в session VFS.
2. START: `ls /workspace/Templates/` — OK.
3. COMPARE: parallel `head -c 150000` (A) + `head -c 200000` (B).

### Ожидание

2 tool → markdown-отчёт с `## Результаты сравнения`, `Расхождений: N`.

### Факт

- Tool #2 (`head` на B): **result len 200 000**, `r7-snapshot/v1` present in export.
- Model reasoning: *"The second head returned empty stdout with no r7-snapshot/v1 content visible"*.
- +5 diagnostic tools (`ls`, `python3`, `cat`, `wc`, `find`), latency ~49 s, iterations 7.
- User message: «Snapshot ещё не в сессии или содержит пустые данные».

---

## Гипотеза

**Truncation или отсутствие доставки крупного tool result (~200k) в prompt context LLM**, при сохранении полного result в session history API и UI export.

Тот же класс, что в сессиях до фикса instruction (`83F33948`, `7D0D6ED6` — иные корни, но схожее «модель не видит body.text»).

---

## Доказательства для платформы

```
# tool #2 command
head -c 200000 "/session/r7/r7-word_4B8BBCE363542976A99F82CA8D4F1BD22336F133_115.json"

# tool #2 result (начало, из export)
{"schema":"r7-snapshot/v1","editor":"word","docKey":"word:4B8BBCE363542976A99F82CA8D4F1BD22336F133_115",...,"body":{"text":"СУБЛИЦЕНЗИОННЫЙ ДОГОВОР № ЭЛ-08/2026...
```

```
# assistant reasoning (тот же message id)
The second `head` returned empty stdout with no `r7-snapshot/v1` content visible
```

Противоречие: history ≠ model context.

---

## Scope агента (уже сделано, не решает platform bug)

Instruction [`agent/instruction`](../agent/instruction):

- transport: 2× `bash head`, 0 tool после batch;
- success rule: если stdout содержит `r7-snapshot/v1` — не объявлять snapshot пустым;
- запрет post-read (`ls`, `find`, `python3`, …).

Модель **всё равно нарушила** instruction в чате 4B8BBCE (чат через ~2 мин после patch).

---

## Запрос к Ladcraft

1. Подтвердить, какой лимит применяется к `tool_call_result` при формировании контекста для LLM vs при записи в history.
2. Для `bash` tool results >N KB: передаётся ли тело в модель целиком, обрезается ли, или подменяется placeholder/`{}`?
3. Возможность: для JSON snapshot отдавать в модель **только** `body.text` (extract на стороне runtime) без 200k сырого JSON.
4. Метрика/лог: `tool_result_bytes_sent_to_model` vs `tool_result_bytes_stored`.

---

## Workaround (кейс, без смены ADR-001)

- Не переходить на skill VFS read (`read_r7_snapshot_text`) — prod TIMEOUT ~600 s (ADR-001).
- Smoke [`smoke_download.js`](../smoke_download.js): assert 2 bash, no post-read, `r7-snapshot/v1` in head result, отчёт в чате.
- Плагину: см. [`cases/cursor_exchange/ladcraft-r7-4B8BBCE-plugin-not-at-fault.md`](../../cursor_exchange/ladcraft-r7-4B8BBCE-plugin-not-at-fault.md).

---

## Связанные ADR

[`cases/compare-r7/docs/architecture-decisions.md`](../../compare-r7/docs/architecture-decisions.md) — ADR-001 (bash head transport), ADR-006 (fixed transport).
