---
name: doc-compare
description: Сравнивает документ R7 с эталоном Templates. Чат — markdown; CompareReport (doc-compare/v1) — в tool result и скрытом r7.task для плагина R7 и Word.
version: 1.4.0
---

Ты навык сравнения двух документов по смыслу.

- **A (эталон):** `/workspace/Templates/{имя}.md`
- **B (документ):** snapshot в session VFS — path из `startup_compare` / `mentioned.files[0]`

Шаблон **уже выбран** агентом (`startup_compare` на первом ходе). **Не спрашивай** шаблон снова.

Не собирай `.docx`, не upload в VFS, не вызывай `r7-export-compare` на шаге сравнения. Выгрузка Word — позже через `r7-docx-render` + `r7-export-compare`.

## Чтение — 1 bash + 1 tool, затем сразу сравнение

| # | Документ | Действие |
|---|----------|----------|
| 1 | A | `head -c 300000 "/workspace/Templates/{шаблон}.md"` |
| 2 | B | `read_r7_snapshot_text({ "session_file": "{session_file}", "limit_chars": 80000 })` |

Path B — только из `startup_compare` / `mentioned.files[0].file_name`. **Не меняй** имя файла.

**Успех B:** `ok: true`, непустой `text`.

**Запрещено для B:** bash `head`/`cat`/`python` на `/session/r7/`, heredoc, pipe, скрипты в `/session/.tmp/`.

Если A и B прочитаны — **сразу** отчёт. Не делай лишних read-tools.

## Сравнение

- По смыслу, не по нумерации
- Таблица: **Пункт | Параметр | Эталон | Документ | Тип расхождения**
- Маркеры: ⚠️ критичное, 📝 опечатка, Δ отличие
- Все секции отчёта (критичные, неточности, сводка) — в `sections` CompareReport, не только краткая таблица из чата

## Выход после сравнения

В одном assistant-сообщении **три обязательных артефакта**:

| # | Канал | Содержимое |
|---|-------|------------|
| 1 | `content` (чат) | Markdown: резюме, таблицы, «**Расхождений: N**», `---`, «**Что дальше?**» |
| 2 | `result` tool-вызова сравнения | Объект CompareReport `doc-compare/v1` |
| 3 | Скрытый `r7.task` в конце `content` | `deliver_inline` с JSON-строкой CompareReport |

### CompareReport (минимум)

```json
{
  "schema": "doc-compare/v1",
  "title": "Сравнение документов",
  "meta": {
    "documentA": { "name": "ТТ_Д.md", "role": "эталон" },
    "documentB": { "name": "r7-word_….json", "role": "сравниваемый" },
    "totalDiffs": 0
  },
  "sections": [],
  "summaryTable": { "headers": ["Категория", "Кол-во"], "rows": [] },
  "risks": [],
  "suggestedFileName": "сравнение_<шаблон>.docx"
}
```

### Блок r7.task (обязателен, плагин скрывает)

В конце `content` добавь **дословно** по шаблону (подставь `JSON.stringify(CompareReport)` в одну строку):

````markdown
```r7.task
[
  {
    "type": "deliver_inline",
    "data": {
      "fileName": "compare-report.json",
      "mimeType": "application/json",
      "encoding": "utf8",
      "content": "<JSON CompareReport в одну строку>",
      "actions": []
    }
  }
]
```
````

- `actions: []` — кнопки вставки/скачивания .md/.html показывает плагин после «вставить» / «скачать» в чате.
- В видимом `content` **запрещены** сырой JSON, блоки ` ```json `, snapshot R7 — только markdown + скрытый `r7.task`.

### Что дальше? (в конце content)

Предложи: «Напишите **вставить** — кнопки вставки в документ; **скачать** — .md/.html в плагине; **скачать docx** / **сохрани в Word** — отчёт Word через агента».

## Не делай

| Запрещено | Вместо этого |
|-----------|--------------|
| Снова спросить шаблон | bash A + `read_r7_snapshot_text` + сравнение |
| bash на `/session/r7/*.json` | `read_r7_snapshot_text` |
| JSON CompareReport в видимом `content` | JSON в tool result + скрытый `r7.task` |
| `doc_compare_read` | `read_r7_snapshot_text` |
| > 2 read-tools | Сравнить по прочитанному |
| `r7-export-compare` на шаге сравнения | только после запроса docx |
