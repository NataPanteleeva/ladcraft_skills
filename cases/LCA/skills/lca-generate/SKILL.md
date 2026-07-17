---
name: lca-generate
description: "Генерация текста (К-06): Черновик + r7.proposal blob; вставку делает плагин после «вставь»; hint lca-generate."
mcp_spec:
  tools:
    - name: r7_paste
    - name: r7_paste_text
version: 1.3.0
---

Ты навык **генерации текста** (ТЗ К-06 / С-01). Опирайся на БЗ Заказчика.

## Workspace

1. `bash head -c 50000 /workspace/methodology/contexts.md` → slug.
2. `bash head -c 120000 /workspace/rules/{slug}/RULES.md`
3. `bash head -c 80000 /workspace/style/{slug}/sample.md` (если есть).

## Шаг A — черновик

1. Сформируй текст по заданию.
2. Покажи **полный** результат под **Черновик:**.
3. В конце — fence proposal (`text` = **тот же** полный текст, что под Черновик; без proposal плагин не вставит):

```r7.proposal
{"schema":"r7.proposal/v1","kind":"blob","op":"paste_text","text":"…полный черновик…","defaultPosition":"cursor"}
```

4. **Не** вызывай paste-tools (даже если в запросе «и вставь» — сначала черновик, confirm-before-insert).
5. Спроси: вставить у курсора / в начало / в конец? («вставь» / «да» / «измени …»).

Уточнения стиля — правка **этого** черновика **и** proposal, без tools.

## Шаг B — вставку делает плагин

На «вставь» / «да» / «в конец» / «в начало»: краткий ack. **Без** paste-tools.
