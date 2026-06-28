# approved-variants — репозиторий удачных вариантов

Каталог **зафиксированных, проверенных** конфигураций агентов и сопутствующих артефактов Ladcraft.  
Живая разработка остаётся в `cases/<case_name>/`; сюда попадают только снимки, которые можно безопасно клонировать или откатить.

## Как пользоваться

1. Открой [`manifest.json`](manifest.json) — индекс всех вариантов и тегов.
2. Зайди в папку варианта → прочитай `README.md` (сопроводительная документация).
3. Восстановление на prod: `agent-patch` / `agent-bind` по путям из `agent/prod.json` и instruction из снимка.

## Правила добавления варианта

- Папка: `cases/approved-variants/<variant-id>/`
- Обязательно: `README.md`, `variant.json`, `agent/instruction`, `agent/prod.json`
- В `variant.json` — теги (`tags`), дата верификации, ссылка на исходный кейс
- В README — **что именно** сработало и **что отклонено**

## Варианты

| id | Теги | Описание |
|----|------|----------|
| [`r7-document-compare-fast-templates`](r7-document-compare-fast-templates/) | `fast-templates`, `r7`, `compare` | R7 compare: bash-список шаблонов на START |

## Связь с каноном

- Общие правила Ladcraft: `<repo>/.pi/`
- R7 transfer: `cases/doc_compare/docs/r7-plugin-data-contract.md`
- Разработка compare-r7: `cases/compare-r7/` (может убегать вперёд от снимка здесь)
