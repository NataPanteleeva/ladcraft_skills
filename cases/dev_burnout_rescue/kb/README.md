# База знаний демо-кейса

Эти материалы агенты загружают в воркспейс и ищут через `fileSearch` с `path_prefixes`.
В живом агенте они лежат под `/workspace/...`:

- `methodology/triage_spec.json` → `/workspace/methodology` — типы инцидентов и где искать совет (decompose-спека).
- `advice/*.md` → `/workspace/advice` — советы по типам инцидентов (rule_id `ADV-*`).
- `antipatterns/*.md` → `/workspace/antipatterns` — «как не надо» (rule_id `ANTI-*`).
- `pep_talks/*.md` → `/workspace/pep_talks` — мотивационные тексты для pep talk в финале.

Структура воспроизводит подход рабочего кейса `contract_compose_validate`: методика + правила + примеры
загружаются в БЗ агента, а агенты опираются на них, а не на «память».

## Покрытие

- `methodology/triage_spec.json` (v1.1.0) — 11 типов инцидентов + `misc`: `bug`, `legacy`, `deadline`,
  `impostor_syndrome`, `meeting_overload`, `merge_hell`, `flaky_tests`, `scope_creep`, `code_review_hell`,
  `oncall_pager`, `context_switching`.
- `advice/` — совет на каждый тип (+ `general.md` для `misc`); в каждом есть блок «Варианты по ситуации».
- `antipatterns/` — набор «как не надо» с буллетом «Дешёвая альтернатива».
- `pep_talks/` — мотивашки с разными тонами (нежный, бодрый, стоический, токсично-ласковый и т.д.)
  — финал подбирается под `TOXICITY_LEVEL`.

Список типов инцидентов всегда берётся из `triage_spec` (не хардкодится в инструкциях агентов).
