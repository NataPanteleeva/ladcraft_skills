# Приёмочный датасет LCA (ПМИ §5)

Тестовые `.docx` и сценарии запросов для ручной проверки функционала ТЗ  
[`5_agent_lingvisticheskaya_proverka_tekstov.docx`](../5_agent_lingvisticheskaya_proverka_tekstov.docx)  
и чеклиста [`TZ_REQUIREMENTS_CHECKLIST.md`](../TZ_REQUIREMENTS_CHECKLIST.md).

## Состав

| # | Документ | Жанр | Задания |
|---|----------|------|---------|
| 01 | [`texts/01-letter-supplier-delay.docx`](texts/01-letter-supplier-delay.docx) | письмо | [`tasks/01-letter-supplier-delay.tasks.md`](tasks/01-letter-supplier-delay.tasks.md) |
| 02 | [`texts/02-contract-liability.docx`](texts/02-contract-liability.docx) | договор | [`tasks/02-contract-liability.tasks.md`](tasks/02-contract-liability.tasks.md) |
| 03 | [`texts/03-announcement-meeting.docx`](texts/03-announcement-meeting.docx) | объявление | [`tasks/03-announcement-meeting.tasks.md`](tasks/03-announcement-meeting.tasks.md) |
| 04 | [`texts/04-report-june.docx`](texts/04-report-june.docx) | отчёт / executive | [`tasks/04-report-june.tasks.md`](tasks/04-report-june.tasks.md) |
| 05 | [`texts/05-article-communications.docx`](texts/05-article-communications.docx) | general + yoda | [`tasks/05-article-communications.tasks.md`](tasks/05-article-communications.tasks.md) |
| 06 | [`texts/06-office-digital-chaos.docx`](texts/06-office-digital-chaos.docx) | general (смешанные ошибки) | [`tasks/06-office-digital-chaos.tasks.md`](tasks/06-office-digital-chaos.tasks.md) |

Пересборка docx: `python cases/LCA/acceptance/_build_fixtures.py`

## Карта покрытия ТЗ

| Требование | Где прогонять |
|------------|----------------|
| ФТ-01 проверка | все 6; особенно 01, 02, 05, **06** (полный спектр ошибок) |
| ФТ-02 разные правила | 02 (contract vs announcement), 01 letter, 03 announcement, 04 report, **06 §C** |
| ФТ-03 правка выделения | 02 §C, 03 §D, 05 §F |
| ФТ-04 рекомендации без правки | 01 §C, 03 §A, 05 §C |
| ФТ-05 создание + вставка | 01 §F, 03 §C, 04 §D |
| ПМИ 5.3.1 чат + курсор | 03 §C |
| ПМИ 5.3.2 рекомендации | 05 §C |
| ПМИ 5.3.3 правка выделения | 02 §C |
| ПМИ 5.3.4 два контекста | 02 §B |
| ПМИ 5.3.5 повторная проверка | 01 §G, 03 §F, 05 §G |
| ПМИ 5.3.6 смысл | 02 §F, 04, 05 §G |
| Analyze / comment / yoda / executive | 04, 05; comment — 01/04/05 |

## Как прогонять

1. R7 Word + плагин **ladcraft-r7_agui** (или `ladcraft-r7_new`), агент LCA `f5BwCaKDeDDG71zHJPvid`.
2. Открыть соответствующий `.docx`, новый чат, синхронизация документа.
3. Идти по файлу `tasks/*.tasks.md` по порядку; фиксировать pass/fail и фактический навык.
4. Для «только рекомендации» — убедиться, что файл на диске не изменился до «исправь» / кнопки apply.

## Протокол (шаблон)

| Кейс | Шаг | Ожидание | Результат | Заметка |
|------|-----|----------|-----------|---------|
| 05 | C5 опечатки | findings, doc не изменён | ⬜ | |
| 06 | A1 полный спектр | орфо/грамм/пункт/стиль/логика | ⬜ | |
| 05 | D8 Все после Undo | замены в Word | ⬜ | |
| 02 | B3 два контекста | разные замечания | ⬜ | |
