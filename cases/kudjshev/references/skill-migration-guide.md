# Руководство по миграции приложений-навыков

Этот документ описывает процесс переноса навыков из стороннего формата (экспорт прототипного приложения) в формат платформы Gtpzator 2.0. Гайд предназначен прежде всего для агента, выполняющего миграцию.

---

## Форматы

### Исходный формат (сторонняя платформа)

Файл экспорта — JSON верхнего уровня:

```json
{
  "version": "1.0",
  "exported_at": "...",
  "skills": [ ... ]
}
```

Каждый навык в массиве `skills`:

```json
{
  "name": "skill_name",
  "description": "Краткое описание",
  "body": "Markdown — системный промпт / инструкция для агента",
  "scripts": [
    {
      "name": "toolName",
      "description": "Описание инструмента",
      "input_schema": { "type": "object", "properties": { ... }, "required": [ ... ] },
      "output_schema": { "type": "object", "properties": { ... } },
      "script_file": "toolName.js",
      "code": "// plain code — не функция, а кусок кода",
      "auth": null
    }
  ],
  "widgets": [
    {
      "name": "widgetName",
      "description": "...",
      "schema": { "type": "object", "properties": { ... } },
      "template": "HTML/Handlebars шаблон",
      "scripts": [
        {
          "type": "javascript",
          "content": "// JS код, выполняемый внутри виджета"
        }
      ],
      "external_libraries": [ ... ]
    }
  ]
}
```

**Ключевые особенности исходного формата:**
- `scripts[]` — инструменты навыка (то, что агент вызывает как tools)
- `widgets[]` — отдельная секция для виджетов; каждый виджет имеет `template` (HTML/Handlebars) и `scripts[].content` (JS-код, исполняемый в браузере)
- `code` в скрипте — произвольный JS-код (не обёрнут в функцию), использует специфические глобалы: `input`, `returnResult()`, `returnResultInWidget()`, `vfs`, `skillStorage`

### Целевой формат (наша платформа)

Для каждого навыка создаётся директория `backend/skills/{name}/` с файлами:

1. **`add-skill-request.json`** — тело POST-запроса для `POST /application/skill`
2. **`function.js`** (или `{toolName}.js` при нескольких инструментах) — читаемая версия функции

Структура `add-skill-request.json`:

```json
{
  "name": "skill-name",
  "description": "Краткое описание",
  "skill": "Markdown — системный промпт (поле body из исходника)",
  "version": "1.0.0",
  "author": "platform",
  "license": "MIT",
  "tags": ["tag1", "tag2"],
  "category": "productivity",
  "icon": "",
  "cover": "",
  "tools": [
    {
      "name": "toolName",
      "description": "Описание инструмента",
      "capabilities": { "required": [] },
      "environment": { "app": {}, "user": {} },
      "resources": {
        "cpu": 0.5,
        "memory": 128,
        "timeout": 30000,
        "network": { "hosts": [] }
      },
      "schemas": {
        "input": { ... },
        "output": { ... }
      },
      "function": "async function handler(state, params) { ... }",
      "widget": "EJS шаблон (опционально)"
    }
  ]
}
```

---

## Пошаговый процесс миграции

### Шаг 1. Разбор исходного навыка

Для каждого навыка из массива `skills` определи:

- `name` — имя навыка (используется как имя директории и поле `name`)
- `description` — краткое описание
- `body` → поле `skill` (системный промпт)
- `scripts[]` → каждый script становится одним tool в массиве `tools`
- `widgets[]` — ищи виджеты, имена которых совпадают с тем, что вызывается в `returnResultInWidget('widgetName', ...)` в коде скриптов

### Шаг 2. Заполнение метаданных

| Поле | Значение |
|------|----------|
| `name` | Из исходника. Используй kebab-case если имя содержит `_` (необязательно) |
| `description` | Из исходника |
| `skill` | Поле `body` из исходника |
| `version` | `"1.0.0"` |
| `author` | `"platform"` |
| `license` | `"MIT"` |
| `tags` | Подбери 3–5 релевантных тегов на основе описания |
| `category` | Подбери из таблицы ниже |
| `icon`, `cover` | `""` |

**Категории:**

| Категория | Когда использовать |
|-----------|-------------------|
| `data_analysis` | Анализ данных, поиск, отчёты, аналитика |
| `productivity` | Продуктивность, управление задачами, игры |
| `communication` | Коммуникации, уведомления, мессенджеры |
| `development` | Разработка, код, диаграммы, инструменты разработчика |
| `finance` | Финансы, валюты, бухгалтерия |
| `hr` | HR, найм, кандидаты, рекрутинг |

### Шаг 3. Конвертация кода (scripts[].code → function)

**Правила замены глобалов:**

| Исходный код | Наш формат |
|--------------|-----------|
| `input.fieldName` | `params.fieldName` |
| `const { x } = input;` | `const { x } = params;` |
| `returnResult({ ... })` | `return { ... }` |
| `return;` сразу после `returnResult(...)` | Удалить (стал недостижимым кодом) |
| `returnResultInWidget('name', { ... })` | `return { ... }` (данные вернуть напрямую) |
| `vfs` | `state.capabilities.vfs` |
| `skillStorage` | `state.capabilities.storage` |

**Обёртка в функцию:**

```javascript
async function handler(state, params) {
  // код из поля code, с применёнными заменами выше
}
```

**Важно:** если `returnResult(...)` вызывается несколько раз внутри ветвлений (`if/else`, `try/catch`), каждый вызов заменяй на `return`, а не просто убирай. Проверь, что после каждого `return` нет лишнего `return;`.

#### 3a. Секреты и настройки: когда не использовать `skillStorage`

В прототипе часто встречается паттерн: "виджет показывает форму для кредов -> сохранить значения в `skillStorage`".
В целевой платформе такой ввод обычно нужно переносить в настройки навыка:

- `tools[].environment.app` — ключи и конфиг приложения (API key, client id/secret, base URL), общие для всех пользователей.
- `tools[].environment.user` — персональные параметры пользователя при установке навыка.
- `state.capabilities.storage` (`skillStorage`) — только runtime-состояние, которое меняется в работе (OAuth refresh-token, кэш, счётчики, флаги сессии).

Практика миграции:

1. Пройди исходный сценарий и выпиши, какие поля запрашиваются у пользователя.
2. Для каждого поля реши, это app-настройка, user-настройка или runtime KV-данные.
3. Перепиши handler так, чтобы "настройки один раз" читались из `state.environment.app` / `state.environment.user`, а не из `skillStorage.get(...)`.
4. Если виджет был нужен только для ввода кредов, убери его или оставь только для отображения результата.
5. Обнови текст навыка (`SKILL.MD`/промпт), чтобы агент не просил вводить секреты в чат, если они должны приходить из настроек.

Справка по контракту `state.environment.*`: `codebase/docs/content/skill-function-guide.md` (только как read-only reference).

**Пример:**

```javascript
// Исходный код
const filePath = input.filePath;
if (!filePath || !vfs) {
  returnResult({ success: false, error: 'Укажите filePath.' });
  return;
}
const text = await vfs.readFile(filePath);
returnResult({ success: true, text });
```

```javascript
// После конвертации
async function handler(state, params) {
  const filePath = params.filePath;
  if (!filePath || !state.capabilities.vfs) {
    return { success: false, error: 'Укажите filePath.' };
  }
  const text = await state.capabilities.vfs.readFile(filePath);
  return { success: true, text };
}
```

### Шаг 4. Конвертация виджетов

Виджет в исходнике состоит из двух частей, которые нужно объединить в одну строку поля `widget`:

1. **`widgets[i].template`** — HTML-шаблон (Handlebars или уже EJS)
2. **`widgets[i].scripts[j].content`** — JS-код, исполняемый в браузере

Итоговое поле `widget` = `template` + `<script>` + `content` + `</script>`.

#### 4a. Конвертация Handlebars → EJS

Если шаблон использует Handlebars (`{{...}}`), конвертируй:

| Handlebars | EJS |
|-----------|-----|
| `{{variable}}` | `<%= variable %>` |
| `{{#if condition}}...{{/if}}` | `<% if (condition) { %>...<% } %>` |
| `{{#if condition}}...{{else}}...{{/if}}` | `<% if (condition) { %>...<% } else { %>...<% } %>` |
| `{{#each items}}...{{/each}}` | `<% items.forEach(function(item) { %>...<% }); %>` |
| `{{this}}` внутри `each` | Переменная `item` (или соответствующее имя) |
| `{{this.field}}` внутри `each` | `<%= item.field %>` |

Если шаблон уже использует EJS (`<% %>`, `<%= %>`), оставь как есть.

#### 4b. CSS-классы и Tailwind

Если шаблон использует утилитарные CSS-классы Tailwind (`hidden`, `flex`, `rounded-xl` и т.д.) — **обязательно** подключи Tailwind CDN в начало виджета:

```html
<script src="https://cdn.tailwindcss.com"></script>
```

И добавь `cdn.tailwindcss.com` в `resources.network.hosts` инструмента.

**Без Tailwind класс `hidden` не работает** — элементы будут видны всегда.

#### 4c. Подключение внешних библиотек

Если виджет использует внешние библиотеки (например, `pako` для сжатия), подключи их через `<script src="...">` тегом перед основным JS-кодом. Все подключаемые CDN-хосты добавь в `resources.network.hosts`.

Пример для pako:
```html
<script src="https://cdn.jsdelivr.net/npm/pako@2.1.0/dist/pako.min.js"></script>
```

#### 4d. Итоговая сборка виджета

```
[<script src="Tailwind CDN">]          ← если используется Tailwind
[<script src="lib1.js"></script>]      ← внешние библиотеки
[<meta charset="UTF-8">]              ← meta-теги если есть
HTML-шаблон (EJS)
<script>
JS-код из widgets[i].scripts[j].content
</script>
```

### Шаг 5. Заполнение resources

```json
"resources": {
  "cpu": 0.5,
  "memory": 128,
  "timeout": 30000,
  "network": {
    "hosts": []
  }
}
```

**Как заполнить `network.hosts`:**
- Найди все `fetch(...)` вызовы в коде функции
- Извлеки хост из каждого URL (без протокола и пути)
- Добавь хосты CDN-библиотек из виджета
- Пример: `fetch('https://api.hh.ru/resumes?...')` → `"api.hh.ru"`

**`capabilities.required`:** если инструмент использует `state.capabilities.vfs` — добавь `"vfs"` в массив. Аналогично для других capabilities.

### Шаг 6. Связывание виджета с инструментом

Виджет в исходнике вызывается через `returnResultInWidget('widgetName', data)`. В нашей платформе виджет — это поле `widget` конкретного инструмента, а данные возвращаются через `return data`.

**Алгоритм связывания:**
1. Найди в коде скрипта вызов `returnResultInWidget('widgetName', { ... })`
2. Данные `{ ... }` — это переменные, доступные в EJS-шаблоне виджета
3. Найди виджет с именем `widgetName` в `widgets[]`
4. Помести шаблон виджета (+ JS код) в поле `widget` того инструмента, который вызывал `returnResultInWidget`
5. Замени `returnResultInWidget('widgetName', data)` на `return data`

### Шаг 7. Выходные файлы

**Для навыка с одним инструментом:**
```
backend/skills/{name}/
├── add-skill-request.json
└── function.js
```

**Для навыка с несколькими инструментами:**
```
backend/skills/{name}/
├── add-skill-request.json
├── toolName1.js
├── toolName2.js
└── toolName3.js
```

Отдельные `.js` файлы — читаемая версия функций с нормальными переносами строк. В поле `function` в JSON — та же функция строкой (с `\n` вместо реальных переносов).

---

## Типичные ошибки и как их избежать

### 1. `hidden` класс не скрывает элемент

**Причина:** Tailwind CSS не подключён.
**Решение:** Добавить `<script src="https://cdn.tailwindcss.com"></script>` в начало виджета и `cdn.tailwindcss.com` в `network.hosts`.

### 2. `returnResultInWidget` не является функцией

**Причина:** функция из исходного формата не была заменена.
**Решение:** Заменить `returnResultInWidget('name', data)` на `return data`.

### 3. JS-код виджета не выполняется

**Причина:** Блок `widgets[i].scripts[].content` не был добавлен в шаблон.
**Решение:** Всегда проверять поле `widgets[i].scripts` в исходнике. Если оно не пустое — добавить содержимое в `<script>...</script>` в конце виджета.

### 4. Конфликт имён переменных

**Причина:** Внутри исходного кода могла быть переменная `params` (например, параметры URL), которая конфликтует с переименованным `input` → `params`.
**Решение:** При переименовании `input` → `params` проверить, нет ли в коде других переменных с именем `params`, и при необходимости переименовать их (например, в `urlParams`).

### 5. `return;` после заменённого `returnResult`

**Причина:** В исходнике паттерн `returnResult({...}); return;` — после замены остаётся недостижимый `return;`.
**Решение:** Удалять пустой `return;` после каждого `return { ... }`, полученного из `returnResult(...)`.

### 6. Невалидный JSON

**Причина:** Виджет содержит кавычки или бэкслеши, которые нарушают JSON-строку.
**Решение:** Использовать `JSON.stringify` через Python/Node для правильного экранирования при программной вставке:

```bash
node -e "JSON.parse(require('fs').readFileSync('add-skill-request.json', 'utf8')); console.log('OK')"
```

Всегда проверяй валидность JSON после создания файла.

---

## Пример полной миграции

### Исходный навык

```json
{
  "name": "my_tool",
  "description": "Делает что-то полезное",
  "body": "# My Tool\n\nОписание навыка.",
  "scripts": [
    {
      "name": "doSomething",
      "description": "Выполнить действие",
      "input_schema": {
        "type": "object",
        "properties": {
          "query": { "type": "string" }
        },
        "required": ["query"]
      },
      "output_schema": {
        "type": "object",
        "properties": {
          "result": { "type": "string" }
        }
      },
      "code": "const { query } = input;\nif (!query) {\n  returnResult({ result: 'empty' });\n  return;\n}\nconst res = await fetch('https://api.example.com/search?q=' + query);\nconst data = await res.json();\nreturnResultInWidget('myWidget', { items: data.items });"
    }
  ],
  "widgets": [
    {
      "name": "myWidget",
      "schema": {
        "type": "object",
        "properties": {
          "items": { "type": "array" }
        }
      },
      "template": "<div>{{#each items}}<p>{{this.name}}</p>{{/each}}</div>",
      "scripts": [
        {
          "type": "javascript",
          "content": "console.log('widget loaded');"
        }
      ],
      "external_libraries": []
    }
  ]
}
```

### Результат: `add-skill-request.json`

```json
{
  "name": "my_tool",
  "description": "Делает что-то полезное",
  "skill": "# My Tool\n\nОписание навыка.",
  "version": "1.0.0",
  "author": "platform",
  "license": "MIT",
  "tags": ["example", "search"],
  "category": "productivity",
  "icon": "",
  "cover": "",
  "tools": [
    {
      "name": "doSomething",
      "description": "Выполнить действие",
      "capabilities": { "required": [] },
      "environment": { "app": {}, "user": {} },
      "resources": {
        "cpu": 0.5,
        "memory": 128,
        "timeout": 30000,
        "network": {
          "hosts": ["api.example.com"]
        }
      },
      "schemas": {
        "input": {
          "type": "object",
          "properties": {
            "query": { "type": "string" }
          },
          "required": ["query"]
        },
        "output": {
          "type": "object",
          "properties": {
            "items": { "type": "array" }
          }
        }
      },
      "function": "async function handler(state, params) {\n  const { query } = params;\n  if (!query) {\n    return { items: [] };\n  }\n  const res = await fetch('https://api.example.com/search?q=' + query);\n  const data = await res.json();\n  return { items: data.items };\n}",
      "widget": "<div><% items.forEach(function(item) { %><p><%= item.name %></p><% }); %></div>\n<script>\nconsole.log('widget loaded');\n</script>"
    }
  ]
}
```

### Результат: `function.js`

```javascript
async function handler(state, params) {
  const { query } = params;
  if (!query) {
    return { items: [] };
  }
  const res = await fetch('https://api.example.com/search?q=' + query);
  const data = await res.json();
  return { items: data.items };
}
```

---

## Чеклист для каждого навыка

- [ ] Директория `backend/skills/{name}/` создана
- [ ] `add-skill-request.json` создан, JSON валиден
- [ ] Все `input.X` заменены на `params.X`
- [ ] Все `returnResult({...})` заменены на `return {...}`
- [ ] Все `returnResultInWidget('name', data)` заменены на `return data`
- [ ] Все `vfs` заменены на `state.capabilities.vfs`
- [ ] Все `skillStorage` заменены на `state.capabilities.storage`
- [ ] Для каждого секрета определён источник: `environment.app`, `environment.user` или runtime KV (`skillStorage`)
- [ ] "Постоянные" креды не читаются из `skillStorage.get(...)`, а берутся из `state.environment.*`
- [ ] Виджет не используется как форма ввода секретов, если эти данные должны приходить из настроек навыка
- [ ] Лишние `return;` после замены `returnResult` удалены
- [ ] Шаблон виджета переведён с Handlebars на EJS (если нужно)
- [ ] JS-код из `widgets[i].scripts[].content` добавлен в виджет через `<script>...</script>`
- [ ] Tailwind CDN добавлен, если виджет использует Tailwind-классы
- [ ] `cdn.tailwindcss.com` добавлен в `network.hosts` (если нужно)
- [ ] Все внешние CDN-библиотеки добавлены в виджет и в `network.hosts`
- [ ] Все fetch-хосты из кода функции добавлены в `network.hosts`
- [ ] Отдельный `function.js` (или `{toolName}.js`) создан
- [ ] JSON проверен на валидность: `node -e "JSON.parse(...)"`
