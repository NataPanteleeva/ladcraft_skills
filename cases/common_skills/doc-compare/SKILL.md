---
name: doc-compare
description: Сравнивает документ R7 с эталоном Templates. read_r7_snapshot_text для B; markdown в чат; CompareReport (doc-compare/v1) в tool result.
version: 1.2.0
---



> **Статус:** рабочий вариант. Плагин `ladcraft-r7`, session VFS. Документ B читается через **`read_r7_snapshot_text`** (skill VFS), не bash.



Ты навык сравнения двух документов по смыслу.



- **A (эталон):** `/workspace/Templates/{имя}.md` — уже в workspace

- **B (документ):** snapshot из `mentioned.files[0]` — уже прикреплён плагином



После выбора шаблона (имя или «№N» из списка) **не спрашивай шаблон снова** и не возвращайся к блоку «Старт».



Не собирай `.docx`, не upload в VFS, не используй `doc_compare_read`, не возвращай `r7.task`.



---



## Старт (шаблон ещё не выбран)



Документ B **уже в VFS** от плагина R7 — **не спрашивай**, какой документ проверять.



1. **`resolve_r7_document`**: `session_file` из `mentioned.files[0].file_name`, `doc_key` из title `R7: word:…::agent:…`. Retry 3×2000 мс.

2. **`list_templates`** → эталоны из `/workspace/Templates/` (папка **Templates** в «Файлах агента»).

3. Нумерованный список шаблонов + «выберите шаблон (имя или №N)».

4. Не читай B до выбора шаблона.



---



## Сравнение (шаблон уже выбран)



### Чтение — 1 bash для A + 1 tool для B, затем сразу сравнение



Path B — **только** `session_file` из `startup_compare` / `resolve_r7_document` / `mentioned.files[0].file_name`. **Не меняй** имя файла, не добавляй пробелы.



| # | Документ | Действие |

|---|----------|----------|

| 1 | A | `head -c 300000 "/workspace/Templates/{шаблон}.md"` |

| 2 | B | `read_r7_snapshot_text({ "session_file": "{session_file}", "limit_chars": 80000 })` |



**Успех B:** `ok: true` и непустой `text` в ответе tool.



**Жёстко запрещено для B:** bash `head`/`cat`/`python` на `/session/r7/`, heredoc, pipe, скрипты в `/session/.tmp/`, угадывание path.



Если A и B прочитаны — **сразу** пиши отчёт. Не делай лишних read-tools «для проверки».



### Сравнение



- По смыслу, не по нумерации

- Таблица: **Пункт | Параметр | Эталон | Документ**

- Маркеры: ⚠️ критичное, 📝 опечатка, Δ отличие



---



## Выход



| Канал | Содержимое |

|-------|------------|

| `content` (чат) | Markdown: резюме, таблицы, «**Расхождений: N**», «**Что дальше?**» |

| `result` tool-вызова | Один JSON CompareReport `doc-compare/v1` |



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



**В `content` запрещены:** JSON CompareReport, сырой snapshot, код.



---



## Не делай



| Запрещено | Вместо этого |

|-----------|--------------|

| Снова спросить шаблон после «№3» / имени | bash A + `read_r7_snapshot_text` + сравнение |

| bash/python на `/session/r7/*.json` | `read_r7_snapshot_text` |

| JSON в `content` | JSON только в tool result |

| `doc_compare_read` | `read_r7_snapshot_text` |

| > 2 read-tools | Сравнить по прочитанному |

