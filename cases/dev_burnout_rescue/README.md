# Кейс: «Спасатель выгоревшего разработчика»

Демонстрационный мульти-агентный кейс Ladcraft. К агенту приходит уставший разработчик с бессвязным
«криком души», а система превращает его в спокойный структурированный **«План спасения»**: раскладывает
страдания на инциденты, по каждому выдаёт разбор и совет, собирает итоговый документ и показывает карточку
состояния.

Цель кейса — за **один прогон** показать все ключевые возможности правил и навыков Ladcraft.

## Состав кейса (раскладка по канону `cases/<case_name>/`)

```
dev_burnout_rescue/
  burnout_toolkit/              навык (slug = имя папки): 11 инструментов + general.lib
  burnout_orchestrator_agent/   агент-оркестратор (instruction.md)
  burnout_worker_agent/         агент-воркер (instruction.md)
  kb/                           База знаний: методика triage + советы по всем типам инцидентов,
                                антипаттерны и pep talks (разные тоны). Грузится в /workspace, ищется fileSearch

  inputs/                       примеры входа (крик души) для /session
```

## Что какую возможность показывает

| Возможность канона | Где показана |
| --- | --- |
| `sql-storage` (PostgreSQL, scope `$USER`) | `start_rescue`, `log_incident`, `get_session`, `record_diagnosis` — журнал `rescue_session`/`incidents`/`diagnoses` |
| VFS, межагентский слой `/user` | `start_rescue` (`complaint.json`), `get_complaint`, `save_advice` (разборы по `note_path`) |
| VFS, видимый слой `/workspace` | `compose_rescue_plan` пишет `rescue_plan.md` + `pep_talk.md` |
| `general.lib` (shared helpers) | общие хелперы в `SKILL.md` (asObject, sqlEsc, ensureSchema, extractRows, билдеры путей) |
| widget (EJS, native handler) | `show_burnout_card` → виджет `burnoutCard` |
| `environment.user` (install-time конфиг) | `get_survival_tip` (`TOXICITY_LEVEL`, `DEV_NAME`) — объявлен в `SKILL.md -> mcp_spec.tools[]` |
| второй рантайм `python@3` | `roast_or_toast` (`async def handler`, `scriptFile` обязателен) |
| мульти-агент (`delegateToAgents`, изоляция контекста) | оркестратор → воркер волной `join_policy:"wait_all"` |
| host-инструменты | `fileSearch`, `requestUserInput`, `requestApproval`, `fileConverter` |
| анти-зацикливание по факту состояния | `check_notes` (`present`/`missing`), а не парсинг `RESULT` |
| детерминированный side effect | реальные записи в VFS/SQL, а не «красивый текст» в ответе |

## Поток

1. Вход: крик души из сообщения или файла `/session/` (`inputs/dev_scream.md` и др.).
2. Оркестратор читает `triage_spec` (`fileSearch`), раскладывает крик на инциденты,
   `start_rescue(complaint=...)` (журнал + `complaint.json`).
3. Делегирует разбор инцидентов воркеру **волной** (`delegateToAgents`, `wait_all`).
4. Воркер читает крик через `get_complaint`, ищет совет в БЗ (`fileSearch`), пишет разбор `save_advice(path=...)`,
   возвращает `RESULT`.
5. Оркестратор сверяется `check_notes`, фиксирует `record_diagnosis`, собирает `compose_rescue_plan`.
6. Показывает `show_burnout_card`, опционально выгружает план в DOCX (`requestApproval` + `fileConverter`).

## Как погонять (headless, отдельный шаг)

Исходники лежат локально. Чтобы запустить кейс на живом агенте, используй курсорные скилы каркаса:

1. Опубликовать навык и создать/связать агентов — скил `ladcraft-prod-publish`
   (см. `.cursor/rules/ladcraft-prod-publishing.mdc`). Привязать `burnout_toolkit` и к оркестратору, и к воркеру;
   создать relation `delegates_to` (оркестратор → воркер); загрузить `kb/` в воркспейс агента; задать
   `environment.user` (`TOXICITY_LEVEL`, `DEV_NAME`) при install.
2. Прогнать диалог (загрузить `inputs/dev_scream.md` в `/session/`, отправить сообщение, смотреть SSE) —
   скил `ladcraft-agent-drive`.

> Публикация на prod в этом репозитории по умолчанию не выполняется — это осознанный шаг оператора.
