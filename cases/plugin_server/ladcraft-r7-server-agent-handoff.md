# Ladcraft R7 Server — изменения на стороне агентов (handoff)

> **Для кого:** агент/разработчик, настраивающий оркестраторы и навыки на платформе Ladcraft.  
> **Плагин:** `plugins/ladcraft_r7_server/` (R7 Document Server, не desktop `ladcraft-r7`).  
> **Связано:** [`ladcraft-r7-server-input-requirements.md`](ladcraft-r7-server-input-requirements.md), навык [`r7-doc-read`](../../skills%20Ladkraft/r7-doc-read/SKILL.md).

---

## 1. Что изменилось по сравнению с desktop-плагином

| Было (`ladcraft-r7`, один документ) | Стало (`ladcraft_r7_server`) |
|-------------------------------------|------------------------------|
| Один snapshot хост-документа в `mentioned.files` | До **N** файлов в `mentioned.files` + блок **`[R7-DOC-BUNDLE]`** |
| Агент знает только «документ B в session VFS» (doc-compare) | Агент получает **слоты** (`slotId`, роль, path, title) |
| Плагин не различает типы агентов | Плагин по `profileId` показывает picker вкладок или скрывает его |
| Навыки сами читают paths | Общий навык **`r7-doc-read`** читает слоты по bundle |

**Агент на Ladcraft не объявляет «сколько документов нужно» через API** — это задаётся в плагине (`profiles/agent-profiles.json`, маппинг `agentId` → `profileId`). Промпт агента должен **соответствовать** выбранному профилю и понимать bundle.

---

## 2. Что плагин присылает в каждом сообщении

### 2.1. `mentioned.files[]`

Только файлы, загруженные плагином в **session VFS** (`r7-snapshot/v1`):

```json
{
  "mentioned": {
    "files": [
      {
        "file_id": "<id>",
        "file_name": "/session/r7/r7-word_….json",
        "mime_type": "application/json"
      }
    ]
  }
}
```

- `files.editor` — **не использовать** (как в doc-compare).
- Workspace-шаблоны в `mentioned.files` **не** попадают.

### 2.2. Блок `[R7-DOC-BUNDLE]` в `content`

После текста пользователя плагин добавляет:

```
[R7-DOC-BUNDLE]
{"schema":"r7-doc-bundle/v1","profileId":"…","agentId":"…","applyTarget":{…},"slots":[…]}
```

Пример (`multi-open-compare`):

```json
{
  "schema": "r7-doc-bundle/v1",
  "profileId": "multi-open-compare",
  "agentId": "550e8400-e29b-41d4-a716-446655440000",
  "applyTarget": { "slotId": "B", "origin": "host" },
  "slots": [
    {
      "slotId": "A",
      "label": "Эталон (вкладка)",
      "origin": "open_tab",
      "path": "/session/r7/r7-word_etalon.json",
      "file_id": "IOxx_…",
      "title": "Договор_эталон.docx",
      "docKey": "word:…"
    },
    {
      "slotId": "B",
      "label": "Сравниваемый документ",
      "origin": "host",
      "path": "/session/r7/r7-word_host.json",
      "file_id": "IOyy_…",
      "title": "Договор_рабочий.docx",
      "docKey": "word:…"
    }
  ]
}
```

Слот `workspace_template` в bundle **без** `path` — имя шаблона агент узнаёт из чата пользователя.

### 2.3. `applyTarget`

Куда плагин применяет `r7.task` — **всегда хост-вкладка** R7. Поле `applyTarget.slotId` подсказывает агенту, какой слот семантически «редактируемый».

---

## 3. Обязательные изменения на Ladcraft (все multi-doc агенты)

### 3.1. Создать и опубликовать навык `r7-doc-read`

| Параметр | Значение |
|----------|----------|
| Папка | [`knowledge-base/skills Ladkraft/r7-doc-read/`](../../skills%20Ladkraft/r7-doc-read/SKILL.md) |
| Назначение | Единое bash-чтение слотов bundle |
| Лимиты | session: `head -c 120000`; workspace: `head -c 200000`; max **5** read за вызов |
| Запрет | python для `/session/r7/…` |

**Binding:** включить во **все** агенты с профилем, где `uiMode` ≠ `hidden` (`multi-open-*`, `data-plus-requirements`), и рекомендуется также в `template-plus-open` для единообразия.

### 3.2. Общие правила для промптов агентов

Скопировать в системный промпт **каждого** server-агента:

```
Плагин R7 Server передаёт контекст документов в блоке [R7-DOC-BUNDLE] (JSON schema r7-doc-bundle/v1) и в mentioned.files[].

Правила:
1. Не проси пользователя загрузить документ, если слот уже в bundle с path и file_id.
2. Не читай файлы сам (bash/python) до активации навыка — маршрутизируй на r7-doc-read или предметный навык.
3. Семантика документов — по slotId из bundle (A, B, data, requirements, host), не выдумывай роли из текста пользователя.
4. applyTarget указывает, куда плагин вставит r7.task — только хост-вкладка R7.
5. Python не читает session VFS — только bash head по path из bundle.
6. Не дублируй полный JSON bundle в ответе пользователю.
```

---

## 4. Профили агентов — что настроить на Ladcraft

Маппинг `agentId` → `profileId` делается в плагине (`profiles/agent-profiles.json`). Ниже — **что менять на Ladcraft** для каждого профиля.

### 4.1. `host-only` (анализ / правка одного файла)

**Пример агентов:** `r7-analyze`, `r7-rewrite`, `r7-search-replace`.

| Элемент | Действие |
|---------|----------|
| Bindings | Существующие навыки без `r7-doc-read` (опционально) |
| Промпт | Уточнить: один слот `host` в bundle; не просить второй документ |
| doc-compare | **Не** привязывать |

**Дополнение к промпту:**

```
profileId: host-only. В bundle один слот host/open_tab с path в session VFS.
Вопросы по документу → r7-analyze. Правки → соответствующий навык r7.task.
Дополнительные вкладки R7 не используются.
```

---

### 4.2. `template-plus-open` (сравнение с шаблоном workspace)

**Существующий сценарий doc-compare**, адаптация под bundle.

| Элемент | Действие |
|---------|----------|
| Bindings | `doc-compare`, `r7-doc-read` (рекомендуется), `r7-docx-render`, `r7-export` |
| Промпт | Обновить [`ladcraft-r7-compare-agent-orchestration.md`](ladcraft-r7-compare-agent-orchestration.md) — см. §4.2.1 |
| doc-compare skill | Принимать слот **B** из bundle (`slotId: "B"`) вместо только `mentioned.files[0]` |

**§4.2.1. Дополнения к промпту compare-агента** (добавить к существующему §1 в orchestration):

```
Плагин: ladcraft_r7_server. В каждом сообщении есть [R7-DOC-BUNDLE]:
- слот A: origin workspace_template (шаблон — выбирается в чате, path пустой до выбора);
- слот B: origin host, path /session/r7/… — открытый документ R7.

Документ B уже в bundle — не предлагай «выбрать документ B».
После выбора шаблона (имя или №N) → активируй doc-compare, передай имя шаблона навыку.
Чтение файлов — только через навык (bash head). Лимиты: A=200000, B=120000.
```

**Изменение в навыке `doc_compare_v1`:**

- Читать B по `path` из bundle слота `B` (или fallback `mentioned.files` с path на B).
- A — по имени шаблона от агента: `/workspace/Templates/{name}`.
- Либо: агент сначала вызывает `r7-doc-read` с `workspaceName`, затем `doc-compare` по уже прочитанным секциям (фаза 2).

---

### 4.3. `multi-open-compare` (два документа из открытых вкладок)

**Новый или отдельный compare-агент** для Document Server.

| Элемент | Действие |
|---------|----------|
| Bindings | `r7-doc-read`, `doc-compare` (или новый `doc-compare-open-tabs`) |
| Промпт | См. ниже |
| Плагин | Пользователь выбирает вкладку для слота A; B = хост |

**Промпт агента (копировать в Ladcraft):**

```
Ты оркестратор сравнения двух документов R7 (Document Server).
Bindings: r7-doc-read, doc-compare.

В [R7-DOC-BUNDLE] profileId multi-open-compare:
- слот A (open_tab) — эталон, выбран пользователем в плагине;
- слот B (host) — сравниваемый документ, текущая вкладка.

Оба слота уже с path в session VFS. Не проси загрузку и не предлагай выбрать документы.

Маршрутизация:
1. Пользователь описал задачу → активируй r7-doc-read (прочитать слоты A и B).
2. Затем doc-compare (или один шаг, если навык объединён) — сравнение по прочитанному.
3. Ответ навыка передай без переписывания.
4. После отчёта — предложи «вставить» / «скачать» (кнопки плагина, как в doc-compare desktop).

Не читай файлы до активации навыка. Не пиши «Сравниваю…».
applyTarget.slotId = B — вставка r7.task только в хост-вкладку.
```

---

### 4.4. `data-plus-requirements` (данные из одной вкладки по требованиям другой)

| Элемент | Действие |
|---------|----------|
| Bindings | `r7-doc-read`, новый или расширенный навык `r7-cross-doc-process` |
| Промпт | См. ниже |

**Промпт агента:**

```
Ты оркестратор обработки документов R7 Server (profileId data-plus-requirements).
Bindings: r7-doc-read, r7-cross-doc-process (или r7-analyze + r7-rewrite по сценарию).

Слоты bundle:
- data (open_tab) — источник фактов/данных;
- requirements (host) — документ с требованиями/спецификацией; сюда же applyTarget (вставка результата).

Маршрутизация:
1. Активируй r7-doc-read — прочитать оба слота.
2. Активируй r7-cross-doc-process: обработать data по правилам из requirements.
3. Если нужны правки в документе requirements → навык возвращает r7.task (только хост).

Не путай роли слотов. Не проси повторную загрузку.
```

*Навык `r7-cross-doc-process` пока не в репозитории — создать по аналогии с `r7-analyze`, вход: секции Slot data / Slot requirements от `r7-doc-read`.*

---

### 4.5. `multi-open-analyze` (основной + до 4 доп. вкладок)

| Элемент | Действие |
|---------|----------|
| Bindings | `r7-doc-read`, `r7-analyze` |
| Промпт | Вопрос по N документам → `r7-doc-read` → `r7-analyze` с контекстом всех слотов |

**Промпт агента:**

```
profileId multi-open-analyze. Слот host + опциональные ref (open_tab) в bundle.
Для вопросов по нескольким документам: r7-doc-read → r7-analyze.
Не проси загрузку, если слоты заполнены в bundle.
```

---

## 5. Таблица bindings по профилям

| profileId | r7-doc-read | doc-compare | r7-analyze | r7-rewrite | r7-export / r7-docx-render |
|-----------|-------------|-------------|------------|------------|----------------------------|
| host-only | опц. | — | да | по сценарию | по запросу |
| template-plus-open | рек. | да | — | — | после compare |
| multi-open-compare | **да** | да | — | — | после compare |
| data-plus-requirements | **да** | — | опц. | опц. | по запросу |
| multi-open-analyze | **да** | — | да | — | — |

---

## 6. Пошаговый чеклист для каждого нового агента

1. **Записать `agentId`** с Ladcraft (UUID оркестратора).
2. **Выбрать `profileId`** из таблицы §4 и добавить в `plugins/ladcraft_r7_server/profiles/agent-profiles.json`:
   ```json
   "agentIds": ["550e8400-e29b-41d4-a716-446655440000"]
   ```
3. **Задеплоить обновлённый JSON** на Document Server (или `profilesUrl`).
4. **Создать/обновить bindings** навыков на Ladcraft (§5).
5. **Вставить промпт** из §4 + общие правила §3.2.
6. **Опционально:** в `description` агента embed для дублирования профиля:
   ```
   <!-- r7-profile:{"profileId":"multi-open-compare",...} -->
   ```
7. **Smoke-тест** (§7).

---

## 7. Smoke-тест после настройки

| # | Профиль | Действие | Ожидание |
|---|---------|----------|----------|
| 1 | host-only | Вопрос по документу | `r7-analyze`, bundle с 1 слотом |
| 2 | template-plus-open | Сравнить с шаблоном | ls Templates → compare, слоты A+B в bundle |
| 3 | multi-open-compare | 2 вкладки Word, picker | bundle A+B, навык читает оба path |
| 4 | любой | Проверить history | В user message есть `[R7-DOC-BUNDLE]` и `mentioned.files` |

Проверка чтения на сервере Ladcraft:

```bash
head -c 120000 /session/r7/r7-word_*.json
# → JSON с "schema":"r7-snapshot/v1"
```

---

## 8. Чего агентам делать нельзя

| Запрещено | Почему |
|-----------|--------|
| Просить загрузить документ, уже в bundle | Плагин уже смонтировал session VFS |
| Читать session VFS через python | Не работает на Ladcraft |
| Игнорировать `[R7-DOC-BUNDLE]` и гадать роли | Роли заданы `slotId` |
| Обещать правки во «второй вкладке» | `r7.task` только в хост |
| Класть полный текст документа в `content` ответа | Утечка, дублирование VFS |
| Менять лимиты `head` без обновления навыков | Контракт smoke |

---

## 9. Миграция существующих агентов (desktop → server)

| Агент desktop | Действие на server |
|---------------|-------------------|
| Compare + Templates | `profileId: template-plus-open`, обновить промпт §4.2 |
| r7-analyze | `host-only`, минимальные правки промпта |
| Новый multi-tab compare | Новый агент + `multi-open-compare` |

Desktop-плагин `ladcraft-r7` и server-плагин могут указывать на **одних и тех же** навыков Ladcraft, если промпты учитывают bundle (server) и legacy-only `mentioned.files` (desktop без bundle).

---

## 10. Ссылки

| Артефакт | Путь |
|----------|------|
| Профили плагина | `plugins/ladcraft_r7_server/profiles/agent-profiles.json` |
| Контракт transfer | [`ladcraft-r7-server-input-requirements.md`](ladcraft-r7-server-input-requirements.md) |
| Навык чтения | [`r7-doc-read/SKILL.md`](../../skills%20Ladkraft/r7-doc-read/SKILL.md) |
| Compare orchestration (desktop, база) | [`ladcraft-r7-compare-agent-orchestration.md`](ladcraft-r7-compare-agent-orchestration.md) |
| Ограничения server | `plugins/ladcraft_r7_server/docs/SERVER-LIMITS.md` |
