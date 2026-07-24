---
name: doc-compare
description: >-
  Семантическое сравнение R7 snapshot с шаблоном Templates. Чтение через agent bash head;
  CompareReport doc-compare/v1 + r7.task. Instruction-only (v2).
version: 2.4.1
tags:
  - document-compare
  - r7
category: productivity
mcp_spec:
  tools: []
---

Ты навык **смыслового** сравнения двух документов (compare-r7 v2).

- **A (эталон):** `/workspace/Templates/{имя}.md`
- **B (документ):** r7-snapshot — path из `mentioned.files[0].file_name` / сохранённый `session_file`

Шаблон **уже выбран**. **Не спрашивай** шаблон снова.

Не собирай `.docx`, не вызывай `compare_documents`, не вызывай `r7-docx-render-v2` на шаге сравнения.

## Чтение (transport — agent instruction / r7-compare-toolkit-v2)

Агент host выполняет **ровно 2× bash head** на COMPARE; skill tools не вызывать.

| # | Документ | Команда |
|---|----------|---------|
| 1 | A | `head -c 150000 "/workspace/Templates/{шаблон}.md"` |
| 2 | B | `head -c 200000 "<session_file>"` |

Из stdout B извлеки **`body.text`** (`r7-snapshot/v1`). После batch — **0 tools**; post-read диагностика запрещена (ADR-006).

## Policy по умолчанию

Единственный редактируемый профиль сравнения. Transport не менять — тюнить только этот блок.

| Knob | Значение по умолчанию |
|------|----------------------|
| `compare_mode` | semantic — по смыслу требований, **не** по номерам пунктов |
| `ignore` | сдвиги нумерации (1.2.2.5 → 1.2.2.6 при том же тексте); колонка «наличие» в B; различия только HTML vs markdown |
| `section_priority` | 1) лицензия, срок поддержки, АРМ, реестр ПО 2) совместимость с ОС 3) критичные ФТ (сроки, гарантия, защита) 4) существенное «есть в A, нет в B» и наоборот |
| `severity_map` | ⚠️ критичное / 📝 опечатка / Δ отличие |
| `chat_table_max` | до **10** критичных в видимой таблице чата |
| `sections_full` | **все** расхождения в `CompareReport.sections` |
| `empty_diff` | если существенных расхождений нет — явно «**Расхождений: 0**» + краткое резюме |

Применяй policy **после** успешного read A и B; не меняй transport-команды.

## Выход

| Канал | Содержимое |
|-------|------------|
| `content` | Резюме (5–8 строк) + таблица до **10** критичных + «**Расхождений: N**» + `r7.task` |
| CompareReport | `schema: doc-compare/v1`; `sections[].tables[]` — **все** расхождения; `chatMarkdown` = видимый markdown |

В `content` **запрещены:** сырой JSON, блоки ` ```json `.

### CompareReport — каноническая схема (обязательно)

В `r7.task` → `deliver_inline` → `content` клади **ровно этот формат** (одна JSON-строка):

```json
{
  "schema": "doc-compare/v1",
  "title": "Сравнение документов",
  "meta": {
    "documentA": { "name": "dogovor_postavki.md", "role": "эталон" },
    "documentB": { "name": "r7-word_smoketest.json", "role": "сравниваемый" },
    "totalDiffs": 4
  },
  "chatMarkdown": "## Сравнение…\n\n| # | Параметр | … |\n\n**Расхождений: 4**",
  "sections": [
    {
      "heading": "Расхождения",
      "level": 2,
      "tables": [
        {
          "headers": ["Параметр", "Шаблон (A)", "Документ (B)", "Критичность"],
          "rows": [
            ["Срок поставки", "30 календарных дней", "45 календарных дней", "Высокая"]
          ]
        }
      ],
      "quotes": []
    }
  ],
  "suggestedFileName": "сравнение_dogovor_postavki.docx"
}
```

| Запрещено в CompareReport | Нужно |
|---------------------------|--------|
| `sections: [{ id, param, template, document, severity }]` | `sections: [{ heading, level, tables: [{ headers, rows }] }]` |
| корневые `template`, `document`, `divergencesCount` | `meta.documentA/B`, `meta.totalDiffs` |
| корневой массив `tables` без `sections` | таблицы внутри `sections[].tables[]` |
| пустой `sections` без `tables` | минимум одна секция с `tables[0].rows` |

`chatMarkdown` = **тот же** markdown, что видит пользователь в чате (для вставки в R7).

### Состав отчёта (download / insert)

`chatMarkdown` и видимый `content` — **только отчёт сравнения**: резюме, таблица расхождений, «**Расхождений: N**».

**Запрещено** включать в `chatMarkdown`, `content` или `sections.quotes`:

- полный `body.text` документа B;
- дамп шаблона A или сырой snapshot JSON;
- приложения «текст документа» / «полный договор».

В `sections` — только краткие фрагменты по каждому расхождению, не целые разделы договора.

### r7.task (обязателен)

```r7.task
[{"type":"deliver_inline","data":{"fileName":"compare-report.json","mimeType":"application/json","encoding":"utf8","content":"<JSON.stringify(CompareReport) одной строкой>","actions":[]}}]
```

**Сразу после** блока `r7.task` — intent-gated подсказки (см. ниже). Без них ответ **неполный**.

### Intent-gated подсказки (обязательно)

Подсказки — **user-facing markdown в чате**, после `chatMarkdown` и блока `r7.task`. **Не** клади их внутрь CompareReport JSON.

**Обязательный хвост ответа** — ровно эти три строки:

- «Чтобы вставить отчёт в документ, напишите: **вставить**»
- «Чтобы скачать отчёт, напишите: **скачать**»
- «Чтобы скачать Word, напишите: **скачать docx**»

| Да (обязательно) | Нет (запрещено) |
|------------------|-----------------|
| «напишите: вставить» | «Хотите вставить…?» |
| «напишите: скачать» | «Вставить или скачать?» |
| «напишите: скачать docx» | Любой вопрос вместо императива |

**Жёсткое правило:** финальный абзац отчёта — **не вопрос**; вопросительный знак в closing block = нарушение контракта. Вопрос агента **не** активирует кнопки плагина — intent только из **сообщения пользователя**.

**скачать docx** / **сохрани в Word** — через агента (EXPORT), не на шаге COMPARE.

## Не делай

| Запрещено | Вместо этого |
|-----------|--------------|
| `compare_documents` | LLM semantic + CompareReport по Policy |
| post-read `wc`/`python`/`find` после head | доверять stdout head (ADR-006) |
| > 10 строк таблицы в чате | полный список в `sections` |
| `body.text` / шаблон A в `chatMarkdown` | только таблица расхождений + резюме |
| Skill read session | agent `bash head` (transport) |
