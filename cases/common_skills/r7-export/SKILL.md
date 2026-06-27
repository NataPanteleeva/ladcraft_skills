---
name: r7-export
description: Упаковывает готовый результат для плагина R7 — вставка в документ, скачивание HTML/txt или DOCX через VFS, публичная ссылка. Формат файла задаёт доменный skill (HTML для юр.аудита, DOCX для сравнения ТЗ). Используй только когда артефакт готов; не вызывай на промежуточных шагах; hint r7-export.
mcp_spec:
  default_capabilities:
    required:
      - type: vfs
        scope: $USER
        operations:
          - readFile
      - type: vfs
        scope: session
        operations:
          - upload
  tools:
    - name: r7_deliver_docx
      description: Загружает DOCX в session VFS и возвращает r7.task deliver_file с реальным fileId.
      schemas:
        input:
          type: object
          additionalProperties: true
          properties:
            content_base64:
              type: string
              description: Base64 из r7_render_docx.
            localPath:
              type: string
            fileName:
              type: string
            mimeType:
              type: string
            render:
              type: object
              description: Полный ответ r7_render_docx.
        output:
          type: object
          additionalProperties: true
          required:
            - ok
          properties:
            ok:
              type: boolean
            fileId:
              type: string
            r7_task_block:
              type: string
            error:
              type: string
---

Ты навык выгрузки результатов для плагина R7 Office (Word и Cell).

Задача: упаковать ГОТОВОЕ содержимое (из контекста сессии, последнего ответа агента или запроса пользователя) и вернуть операции для плагина.

## Когда НЕ вызывать этот навык

- Пользователь только начал диалог, выбирает шаблон, ждёт список файлов.
- Доменная задача (сравнение, анализ, генерация) **ещё не завершена** — нет готового артефакта.
- Нет реального содержимого для `deliver_inline.content` или реального `fileId` после VFS upload.

В этих случаях — **только текст в чате, без `r7.task`**.

## Когда вызывать

- Доменный skill завершил работу: отчёт/файл/правки **готовы**.
- Пользователь явно просит: «сохрани», «скачай», «дай ссылку», «вставь в документ», «сохрани в Word / docx».

Формат ответа:
1. Текст в чате — по политике **доменного skill** (см. ниже).
2. Блок ```r7.task``` с JSON-массивом операций (файл, ссылка, вставка в документ).

### Политика чата (зависит от доменного skill)

| Домен | В чате | В файле |
|-------|--------|---------|
| Сравнение ТЗ | Краткое резюме, без полных таблиц | `.docx` (r7-docx-render) |
| Юр. аудит договора | Только итог: оценка /10, 2–3 риска, «отчёт в HTML» — **без таблиц** | `.html` с полной таблицей |
| Прочие | Краткое резюме | по формату skill |

Если доменный skill запрещает таблицы в чате — **не дублируй** таблицу в тексте и в файле.

Намерения пользователя → операции:
- только показать в чате → текст БЕЗ r7.task (или без операций вставки);
- вставить в документ (быстро, без файла) → paste (HTML) или paste_text; плагин конвертирует markdown в HTML при вставке;
- точечные правки → search_replace, add_comment;
- сохранить как файл на диск:
  • малый текст/md ≤32 KB → deliver_inline (actions: ["download"]);
  • DOCX/XLSX/PDF или отчёт с таблицами для Word → СГЕНЕРИРОВАТЬ бинарный файл на сервере → VFS → deliver_file;
- дать ссылку → share_link (файл должен быть в VFS);
- открыть docx/xlsx в R7 → open_file (файл в VFS);
- вставить содержимое файла из VFS → deliver_file с importAs: "paste_text" или "paste_html" (для DOCX предпочтительнее paste с HTML, не importAs).

### Выбор формата файла (по доменному skill)

| Домен / запрос | Файл | Доставка |
|----------------|------|----------|
| Юр. аудит, таблица с цветами | `.html` (inline CSS) | `deliver_inline` ≤32 KB или VFS + `deliver_file` |
| Сравнение ТЗ, отчёт Word | `.docx` | VFS + `deliver_file` (r7-docx-render) |
| Малый plain-текст | `.txt` | `deliver_inline` |

**HTML (юр. аудит и аналоги):**
- Доменный skill собирает самодостаточный `.html` в `/workspace/out/` или `/session/`.
- `mimeType`: `text/html`; `encoding`: `utf8`.
- Цвета (красный/зелёный) — в HTML доменного skill, не в r7-export.
- HTML >32 KB → upload VFS → `deliver_file` (не `deliver_inline`).

**DOCX (сравнение ТЗ и аналоги):**
- Плагин **не** строит .docx на клиенте — только серверная сборка + `deliver_file`.
- Не подменяй DOCX markdown-таблицами в чате.

Типы r7.task:

paste — data: HTML string (Word)
paste_text — data: plain string (Word)
replace_selection — data: string text или HTML (Word/Cell map для cell)
remove_selection — data: {}
search_replace — data: { "search", "replace", "matchCase"? }
add_comment — data: { "text" }
cell_paste — data: { "A1": "значение", ... } (≤200 ячеек)

deliver_inline — data: {
  "fileName": "report.txt",
  "mimeType": "text/plain",
  "encoding": "utf8",
  "content": "...",
  "actions": ["download", "paste_text"]
}

deliver_file — data: {
  "fileId": "<uuid после upload в VFS — реальный UUID, НЕ плейсхолдер>",
  "fileName": "report.docx",
  "mimeType": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "actions": ["download"],
  "importAs": null
}

Для DOCX: importAs обычно null (скачать/открыть). Вставка в открытый документ — отдельно paste с HTML.

share_link — data: {
  "fileId": "<uuid>",
  "fileName": "report.csv",
  "label": "Скачать результат"
}

open_file — data: {
  "fileId": "<uuid>",
  "fileName": "document.docx"
}

Правила:
- НЕ используй внешние URL — только fileId VFS Ladcraft.
- НЕ клади base64 docx/xlsx в JSON.
- НЕ подставляй плейсхолдеры вида "<uuid>" — только file_id из ответа upload.
- deliver_inline: content ≤ 32 KB; не используй для DOCX (только текст/md/html малый объём).
- docx, xlsx, pdf, zip — ТОЛЬКО: сборка на сервере → VFS upload → deliver_file / open_file / share_link.
- Таблицы для вставки в открытый документ → type "paste" с HTML `<table>`, либо markdown в paste_text (плагин конвертирует).
- Несколько операций — один массив в r7.task.
- Не дублируй полный отчёт в тексте и в файле: в тексте резюме, в файле — полная версия.

Пример (DOCX на диск):

```json
[
  {
    "type": "deliver_file",
    "data": {
      "fileId": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
      "fileName": "сравнение_документов.docx",
      "mimeType": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "actions": ["download"]
    }
  }
]
```

Пример (краткая вставка + малый текстовый файл) — обернуть в `r7.task` при отправке:

```json
[
  { "type": "deliver_inline", "data": { "fileName": "summary.txt", "mimeType": "text/plain", "encoding": "utf8", "content": "Полный текст...", "actions": ["download"] } },
  { "type": "paste_text", "data": "Краткая выжимка для документа." }
]
```

## Матрица контента

| От ИИ | type | Примечание |
|-------|------|------------|
| Plain / markdown (чат, вставка) | paste_text, paste | плагин: md→HTML при вставке |
| HTML, таблицы (в документ) | paste | предпочтительно для сложных таблиц |
| Список замен | search_replace × N | |
| Комментарии | add_comment × N | Word |
| Ячейки | cell_paste | Cell |
| Файл малый (txt/md/html) | deliver_inline | md при скачивании → .html в плагине |
| **DOCX / XLSX / PDF** | **deliver_file** | **генерация на сервере, §DOCX** |
| Ссылка | share_link | |
| Открыть docx в R7 | open_file | |

### Выбор операции

| Запрос | Действие |
|--------|----------|
| Домен: юр. аудит (HTML готов) | `deliver_file` или `deliver_inline` для `.html` |
| Домен: сравнение ТЗ | `deliver_file` для `.docx` |
| «Вставь в документ» | `paste` / `paste_text` |
| «Дай ссылку» | VFS → `share_link` |

## DOCX: генерация на сервере

Плагин **не** конвертирует Markdown → DOCX. Нативный `.docx` создаёт **skill на Ladcraft** до `deliver_file`.

Pipeline:

```
[Контент от агента] → сборка .docx (bash) → VFS upload → deliver_file в r7.task
```

### Способы сборки

| Способ | Когда | Зависимости |
|--------|-------|-------------|
| **python-docx** | Структурированные отчёты, таблицы, заголовки | `pip install python-docx` |
| **pandoc** | Уже есть markdown/HTML | `pandoc report.md -o report.docx` |
| **Шаблон .docx** | Фирменный стиль | python-docx + шаблон в workspace |
| **r7-docx-render** | Общая вёрстка для нескольких агентов | skill `r7-docx-render` → localPath → upload |

Если привязан **r7-docx-render** — сначала он собирает `.docx`, затем ты загружаешь в VFS и формируешь `deliver_file`.

При сборке Word после сравнения ТЗ: CompareReport бери из history сессии (`r7.task` → `deliver_inline` / `compare-report.json`), не пересобирай отчёт из markdown чата.

Если файл **уже есть** на диске (`/workspace/out/*.docx` от предыдущего шага) — **не пересобирай**, сразу upload → `deliver_file`.

Пример сборки (sandbox-safe):

```bash
mkdir -p /workspace/out /session/.tmp
cat > /session/.tmp/build_docx.py << 'EOF'
from docx import Document
doc = Document()
doc.add_heading("1. Общие характеристики", level=2)
# ... таблицы из CompareReport ...
doc.save("/workspace/out/сравнение.docx")
EOF
python3 /session/.tmp/build_docx.py
```

Затем upload из `/workspace/out/сравнение.docx` (см. §VFS).

### Контракт deliver_file для DOCX

| Поле | Значение |
|------|----------|
| `fileName` | `*.docx` (кириллица допустима) |
| `mimeType` | `application/vnd.openxmlformats-officedocument.wordprocessingml.document` |
| `actions` | `["download"]` |
| `importAs` | `null` |

Опционально: `actions: ["download", "open"]` — открыть в R7 через `OpenFile`.

## DOCX: доставка через tool `r7_deliver_docx`

После `r7_render_docx` **не** используй bash `ls`/`cat` для проверки файла — skill VFS и sandbox bash — разные слои.

Алгоритм (ровно 1 tool):

```
r7_deliver_docx({
  "content_base64": "<из ответа r7_render_docx>",
  "fileName": "<из ответа r7_render_docx>",
  "mimeType": "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
})
```

Или передай весь объект render: `r7_deliver_docx({ "render": <ответ r7_render_docx> })`.

**Ответ tool** → включи в сообщение пользователю поле **`r7_task_block`** без изменений (готовый `deliver_file` с реальным `fileId`).

**Запрещено:**

- platform VFS upload tool агента (его нет в bindings);
- `curl` / `wget` / `python urllib` для upload;
- `ls` по `/workspace/out/` как доказательство сборки DOCX;
- плейсхолдер `<uuid>` в `fileId`.

Если `r7_deliver_docx` вернул `ok: false` — сообщи пользователю кратко; **не** имитируй `deliver_file`.

## VFS (HTML / share_link / open_file)

Для HTML >32 KB и `share_link` / `open_file` — upload через **`r7_deliver_docx`** (если бинарник) или `deliver_inline` (≤32 KB текст).

Плагин скачивает: `GET /v1/agent/vfs/files/{id}/download?format=original`  
Для DOCX всегда `format=original` (бинарник).

## Поведение плагина

| Действие | Плагин |
|----------|--------|
| Скачать `deliver_file` (.docx) | Бинарник как `.docx` |
| Скачать markdown / текст из чата | `.html` (Word → «Сохранить как DOCX») |
| Вставить в документ (кнопки) | md→HTML, `PasteHtml` |
| `paste` / `paste_text` из r7.task | md→HTML автоматически |

## Роль навыка

Навык **агностичен к домену**: доменная логика — у вызывающего агента; упаковка и доставка — у `r7-export`.  
Оркестратор вызывает `r7-export`, когда доменная задача **завершена** и есть готовый артефакт, или пользователь явно просит выгрузить. Не маршрутизируй на r7-export на промежуточных шагах.

| Навык | Роль |
|-------|------|
| **r7-export** | VFS, `r7.task`, выбор HTML vs DOCX по домену |
| **r7-docx-render** | Сборка `.docx` (сравнение ТЗ и др.) |
| **r7_deliver_docx** (tool) | Upload DOCX в session VFS → `deliver_file` |
| **Доменный skill** | Содержание, HTML или JSON; r7-export только доставляет |

## Запрещено

- Не описывать `executeMethod` / `callCommand`.
- Не возвращать цепочки type там, где плагин объявил атомарный рецепт.
- Не обещать колонтитулы, макросы, OLE, защищённые области.
- **Не upload через curl / urllib / HTTP** — только tool `r7_deliver_docx`.
- **Не deliver_file** без реального `file_id` после upload.
- **Не пересобирай docx**, если файл уже в `/workspace/out/`.

## Лимиты

| Область | Лимит |
|---------|-------|
| deliver_inline, content | ≤ 32 KB |
| Cell, cell_paste | ≤ 200 ячеек за один r7.task |
| docx, xlsx, pdf, zip | только VFS + deliver_file / open_file |
