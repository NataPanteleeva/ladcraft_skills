---
name: r7-disk-api
description: Авторизация в Р7-Диске (KS 2024 API), просмотр и управление папками и файлами. Создание DOCX/TXT с текстом — только через r7_disk_document (create + content_text), без pip и локального Python.
mcp_spec:
  default_capabilities:
    required:
      - type: key-value-storage
        scope: $USER
        operations:
          - Get
          - Set
  tools:
    - name: r7_disk_login
      description: Авторизуется в Р7-Диске. Если в environment.user заданы URL/логин/пароль — сначала спросите пользователя (сохранённые переменные или другой диск), затем передайте credential_source environment или custom.
      environment:
        user:
          R7_DISK_BASE_URL:
            title: Базовый URL Р7-Диска
            format: string
            description: Например https://cddisk.example.ru (без завершающего слэша).
          R7_DISK_LOGIN:
            title: Логин
            format: string
          R7_DISK_PASSWORD:
            title: Пароль
            format: string
            secret: true
      schemas:
        input:
          type: object
          additionalProperties: false
          properties:
            base_url:
              type: string
              description: Переопределяет R7_DISK_BASE_URL из environment.user.
            login:
              type: string
              description: Переопределяет R7_DISK_LOGIN.
            password:
              type: string
              description: Переопределяет R7_DISK_PASSWORD.
            credential_source:
              type: string
              description: environment — только переменные навыка; custom — только параметры (другой диск). Без этого поля при заполненном environment login вернёт needs_credential_choice.
            web_url:
              type: string
              description: URL веб-интерфейса (/docs, /docs/50) — для якоря и определения корня.
            anchor_directory_id:
              type: integer
              description: ID известной подпапки — корень «Мои документы» определяется по цепочке Parent.
        output:
          type: object
          additionalProperties: true
          required:
            - ok
          properties:
            ok:
              type: boolean
            auth_token:
              type: string
            expired_at:
              type: string
            user:
              type: object
              additionalProperties: true
            modules_access:
              type: array
              items:
                type: string
            my_documents_directory_id:
              type: integer
            my_documents_accessible:
              type: boolean
            my_documents_note:
              type: string
            root_discovery_summary:
              type: string
            accessible_directory_roots:
              type: array
              items:
                type: object
                additionalProperties: true
            agent_message:
              type: string
            standard_folders_warning:
              type: string
            api_base_url:
              type: string
            error:
              type: string
    - name: r7_disk_set_my_documents_directory_id
      description: Сохраняет id корня «Мои документы» в skillStorage, если он известен из диалога или вычислен по родителю подпапки. Вызывай после того, как нашёл корень через parent_chain или пользователь назвал id.
      schemas:
        input:
          type: object
          additionalProperties: false
          required:
            - directory_id
          properties:
            directory_id:
              type: integer
              description: ID корневой папки «Мои документы» (например 42).
            directory_name:
              type: string
              description: Опционально. Имя корня для ответа пользователю.
        output:
          type: object
          additionalProperties: true
          required:
            - ok
          properties:
            ok:
              type: boolean
            my_documents_directory_id:
              type: integer
            directory_name:
              type: string
            persisted:
              type: boolean
            agent_message:
              type: string
            error:
              type: string
    - name: r7_disk_list_directory
      description: Возвращает содержимое папки Р7-Диска — подпапки и документы.
      environment:
        user:
          R7_DISK_BASE_URL:
            title: Базовый URL Р7-Диска
            format: string
          R7_DISK_LOGIN:
            title: Логин
            format: string
          R7_DISK_PASSWORD:
            title: Пароль
            format: string
            secret: true
      schemas:
        input:
          type: object
          additionalProperties: false
          properties:
            directory_id:
              type: integer
              description: Опционально. Если не задан — «Мои документы» определяются автоматически после login.
            auth_token:
              type: string
              description: Токен из r7_disk_login. Если не задан — используется кэш skillStorage или выполняется login.
            base_url:
              type: string
            login:
              type: string
            password:
              type: string
        output:
          type: object
          additionalProperties: false
          required:
            - ok
          properties:
            ok:
              type: boolean
            directory_id:
              type: integer
            directory_name:
              type: string
            parent:
              type: object
              additionalProperties: true
            folders:
              type: array
              items:
                type: object
                additionalProperties: true
            documents:
              type: array
              items:
                type: object
                additionalProperties: true
            counters:
              type: object
              additionalProperties: true
            error:
              type: string
    - name: r7_disk_browse
      description: Дерево папок (рекурсивно). Для «начиная с X» передай folder_name. Покажи пользователю tree_text. Один вызов — не повторяй при ok и do_not_retry.
      environment:
        user:
          R7_DISK_BASE_URL:
            title: Базовый URL Р7-Диска
            format: string
          R7_DISK_LOGIN:
            title: Логин
            format: string
          R7_DISK_PASSWORD:
            title: Пароль
            format: string
            secret: true
      schemas:
        input:
          type: object
          additionalProperties: false
          properties:
            directory_id:
              type: integer
              description: Опционально. По умолчанию — «Мои документы» (авто после login).
            folder_name:
              type: string
              description: Корень обхода по имени (например Ladcraft_Проверка) — без directory_id от пользователя.
            folder_path:
              type: string
              description: Путь от «Мои документы» через /.
            max_depth:
              type: integer
              description: Только для агента; по умолчанию 5. Не спрашивать у пользователя при установке навыка.
            auth_token:
              type: string
            base_url:
              type: string
            login:
              type: string
            password:
              type: string
        output:
          type: object
          additionalProperties: false
          required:
            - ok
            - tree
          properties:
            ok:
              type: boolean
            tree:
              type: object
              additionalProperties: true
            tree_text:
              type: string
            agent_message:
              type: string
            do_not_retry:
              type: boolean
            error:
              type: string
    - name: r7_disk_folder
      description: Операции с папками — create, move, copy, delete, restore, conflict. После login для create передайте auth_token и parent_directory_id из folder_create_example.
      environment:
        user:
          R7_DISK_BASE_URL:
            title: Базовый URL Р7-Диска
            format: string
          R7_DISK_LOGIN:
            title: Логин
            format: string
          R7_DISK_PASSWORD:
            title: Пароль
            format: string
            secret: true
      schemas:
        input:
          type: object
          additionalProperties: false
          anyOf:
            - required:
                - operation
            - required:
                - action
          properties:
            operation:
              type: string
              description: create | move | copy | delete | restore | conflict
            action:
              type: string
              description: Устаревший синоним operation.
            parent_directory_id:
              oneOf:
                - type: integer
                - type: string
              description: Из create_target.parent_directory_id после login.
            names:
              type: array
              items:
                type: string
              description: Несколько папок в одном родителе (create).
            folder_id:
              type: integer
            folder_ids:
              type: array
              items:
                type: integer
            to_directory_id:
              type: integer
            name:
              type: string
            folder_path:
              type: string
              description: Вложенный путь через / для цепочки подпапок (create).
            rule:
              type: integer
              description: Для copy — 0, 1 или 2.
            auth_token:
              type: string
              description: Из r7_disk_login — обязателен при create сразу после login.
            base_url:
              type: string
            login:
              type: string
            password:
              type: string
        output:
          type: object
          additionalProperties: false
          required:
            - ok
          properties:
            ok:
              type: boolean
            action:
              type: string
            folder_id:
              type: integer
            folder_name:
              type: string
            created_folders:
              type: array
              items:
                type: object
                additionalProperties: true
            error:
              type: string
    - name: r7_disk_download
      description: Скачать файл с Р7-Диска — кнопка «Скачать файл» в виджете. Вызывай ТОЛЬКО этот tool при запросе «скачай» (не r7_disk_document download). Нужны directory_id и name.
      environment:
        user:
          R7_DISK_BASE_URL:
            title: Базовый URL Р7-Диска
            format: string
          R7_DISK_LOGIN:
            title: Логин
            format: string
          R7_DISK_PASSWORD:
            title: Пароль
            format: string
            secret: true
      schemas:
        input:
          type: object
          additionalProperties: false
          required:
            - directory_id
            - name
          properties:
            directory_id:
              oneOf:
                - type: integer
                - type: string
            name:
              type: string
            file_name:
              type: string
            auth_token:
              type: string
            base_url:
              type: string
            login:
              type: string
            password:
              type: string
        output:
          type: object
          additionalProperties: true
          required:
            - ok
          properties:
            ok:
              type: boolean
            file_name:
              type: string
            content_base64:
              type: string
            show_download_widget:
              type: boolean
            agent_message:
              type: string
            error:
              type: string
    - name: r7_disk_document
      description: Файлы Р7-Диск (create, read_content, append и др.). Передавайте operation (не только action). Скачивание — r7_disk_download.
      environment:
        user:
          R7_DISK_BASE_URL:
            title: Базовый URL Р7-Диска
            format: string
          R7_DISK_LOGIN:
            title: Логин
            format: string
          R7_DISK_PASSWORD:
            title: Пароль
            format: string
            secret: true
      schemas:
        input:
          type: object
          additionalProperties: false
          anyOf:
            - required:
                - operation
            - required:
                - action
          properties:
            operation:
              type: string
              description: create | read_content | append | prepend | replace | upload | rename | delete | move | copy | exists | get_id_by_name | versions | change_version | convert. Для скачивания используйте r7_disk_download.
            action:
              type: string
              description: Устаревший синоним operation.
            document_id:
              type: integer
            document_ids:
              type: array
              items:
                type: integer
            directory_id:
              oneOf:
                - type: integer
                - type: string
            to_directory_id:
              oneOf:
                - type: integer
                - type: string
            name:
              type: string
            file_name:
              type: string
            content_base64:
              type: string
            content_text:
              type: string
            file_id:
              type: integer
            mime_type:
              type: string
            convert_type:
              type: string
            auth_token:
              type: string
            base_url:
              type: string
            login:
              type: string
            password:
              type: string
            save_to_vfs_path:
              type: string
            web_ui_path:
              type: string
            force_redownload:
              type: boolean
        output:
          type: object
          additionalProperties: true
          required:
            - ok
          properties:
            ok:
              type: boolean
            operation:
              type: string
            action:
              type: string
            content_text:
              type: string
            document_id:
              type: integer
            file_name:
              type: string
            content_base64:
              type: string
            deliverable:
              type: boolean
            delivery_method:
              type: string
            download_status:
              type: string
            download_ready:
              type: boolean
            already_downloaded:
              type: boolean
            do_not_retry:
              type: boolean
            content_base64_present:
              type: boolean
            content_base64_bytes:
              type: integer
            agent_message:
              type: string
            user_action_required:
              type: string
            feedback_prompt_ok:
              type: string
            feedback_prompt_retry:
              type: string
            content_preserved:
              type: boolean
            full_content_replace:
              type: boolean
            web_ui_hint:
              type: string
            web_ui_url:
              type: string
            saved_vfs_path:
              type: string
            size_bytes:
              type: integer
            error:
              type: string
    - name: r7_disk_gost34_generate
      description: Формирует DOCX по ГОСТ34 из шаблона в Р7 Диск и сохраняет результат в папку results.
      environment:
        user:
          R7_DISK_BASE_URL:
            title: Базовый URL Р7-Диска
            format: string
          R7_DISK_LOGIN:
            title: Логин
            format: string
          R7_DISK_PASSWORD:
            title: Пароль
            format: string
            secret: true
          R7_DISK_GOST34_TEMPLATE_DIRECTORY_ID:
            title: ID папки шаблонов ГОСТ34
            format: number
          R7_DISK_GOST34_TEMPLATE_NAME:
            title: Имя шаблона ГОСТ34
            format: string
          R7_DISK_GOST34_RESULT_DIRECTORY_ID:
            title: ID папки результатов ГОСТ34
            format: number
      schemas:
        input:
          type: object
          additionalProperties: false
          required:
            - input_directory_id
            - input_name
          properties:
            input_directory_id:
              oneOf:
                - type: integer
                - type: string
            input_name:
              type: string
            template_directory_id:
              oneOf:
                - type: integer
                - type: string
            template_name:
              type: string
            result_directory_id:
              oneOf:
                - type: integer
                - type: string
            output_name:
              type: string
            conflict_policy:
              type: string
            projectName:
              type: string
            organization:
              type: string
            cipher:
              type: string
            auth_token:
              type: string
            base_url:
              type: string
            login:
              type: string
            password:
              type: string
        output:
          type: object
          additionalProperties: true
          required:
            - ok
            - operation
          properties:
            ok:
              type: boolean
            operation:
              type: string
            output_name:
              type: string
            output_document_id:
              type: integer
            output_size_bytes:
              type: integer
            filledSlots:
              type: integer
            missingSlots:
              type: integer
            recommendations:
              type: array
              items:
                type: string
            warnings:
              type: array
              items:
                type: string
            error:
              type: string
---

# Р7-Диск — авторизация, папки, файлы

Навык работает с REST API Р7-Диска (КС 2024) по инструкции `instruction-for-ks-2024-api-disk.pdf`.

## Цель

1. Авторизоваться в Р7-Диске.
2. Закрепить id корня «Мои документы» (`r7_disk_set_my_documents_directory_id`), если он известен из диалога.
3. Просматривать папки и документы (`r7_disk_list_directory`, `r7_disk_browse`).
4. Управлять папками (`r7_disk_folder`) и файлами (`r7_disk_document`).
5. Оформлять документы по шаблону ГОСТ34 из папки шаблонов Р7 Диск (`r7_disk_gost34_generate`).

## Подготовка (один раз при установке)

Заполните переменные `environment.user`:

| Переменная | Обязательность | Пример |
|---|---|---|
| `R7_DISK_BASE_URL` | да | `https://cddisk.gptz.lad-soft.ru` |
| `R7_DISK_LOGIN` | да | `superadmin` |
| `R7_DISK_PASSWORD` | да | пароль |
| `R7_DISK_WEB_UI_URL` | **нет** | `https://admin.gptz.lad-soft.ru` — для подсказки ручного скачивания |
| `R7_DISK_DEFAULT_PARENT_DIRECTORY_ID` | **нет** | Только для админа, если login не находит корень. **Не в форме установки** — обычному пользователю не нужен |
| `R7_DISK_GOST34_TEMPLATE_DIRECTORY_ID` | **нет** | ID папки шаблонов ГОСТ34 (если не передаётся в параметрах tool) |
| `R7_DISK_GOST34_TEMPLATE_NAME` | **нет** | Имя шаблона, по умолчанию `gost34_task_description_template.docx` |
| `R7_DISK_GOST34_RESULT_DIRECTORY_ID` | **нет** | ID папки для готовых ГОСТ34-документов |

**При публикации** Ladcraft требует заполнить **только** переменные из `mcp_spec.environment.user`. Сейчас это три поля: URL, логин, пароль. ID папки при установке **не спрашивается** — корень определяется автоматически после `r7_disk_login`.

### Важно: веб-адрес ≠ API-адрес

| Назначение | URL (пример GPTZ) | Использовать в `R7_DISK_BASE_URL`? |
|---|---|---|
| Веб-интерфейс админки | `https://admin.gptz.lad-soft.ru/` | **Нет** |
| API Диска (KS 2024) | `https://cddisk.gptz.lad-soft.ru` | **Да** |
| Документация API (Swagger в браузере) | `https://cddisk.gptz.lad-soft.ru/docs` | **Нет** — это UI для людей, не базовый URL навыка |

Навык **никогда не «угадывает»** API-хост из списка `network.hosts`. Запросы идут на URL в порядке: параметр `base_url` → кэш после успешного `r7_disk_login` → `R7_DISK_BASE_URL` при установке.

Список `resources.network.hosts` в meta — это **белый список** разрешённых доменов для `fetch`, а не адрес сервера.

Если в чате раньше пробовали `cddisk.education.demo`, этот URL мог остаться в **параметрах установки навыка** на платформе — тогда агент честно ходит на `education.demo`, хотя вы заходите в браузере на `admin.gptz.lad-soft.ru`.

**Что сделать:** в настройках установленного навыка `r7-disk-api` задайте `R7_DISK_BASE_URL=https://cddisk.gptz.lad-soft.ru` (уточните точный API URL у администратора) и переустановите/обновите навык.

**Папку «Мои документы» клиенту настраивать не нужно.** После `r7_disk_login` навык ищет личный корень: поля User, стандартный id=1, якорь из `web_url` или `anchor_directory_id` (`/docs/50` → цепочка Parent), сканирование id до 512.

**Кэш корня (`skillStorage`):** после успешного login id корня сохраняется в KV (`r7_disk_my_documents_directory_id`) и переиспользуется в следующих запусках агента. Навык требует capability `key-value-storage` (`default_capabilities` в frontmatter).

### Обычный пользователь (не суперадмин)

- На **id=1** часто **HTTP 406** — это не «нет Диска», а **другой** личный корень (например id=42).
- **Не спрашивайте числовой id корня** у пользователя. Читайте после login: `my_documents_directory_id`, `storage_state`, `create_target`, `agent_message`.
- Если `my_documents_directory_id` **null** (`root_not_found: true`) — **сразу один вопрос**: имя папки или URL `/docs/N`. **Не** перебирайте `directory_id` 0–10.
- Если login **не нашёл** корень, но известен id **подпапки** (пользователь создал папку, дал `/docs/51` или id=51) — повтори `r7_disk_login` с `anchor_directory_id: 51` (или `web_url` с этим id).
- Если корень **уже вычислен** (например `list_directory` по id=51 показал родителя «Мои документы» id=42) — вызови **`r7_disk_set_my_documents_directory_id`** с `{ "directory_id": 42 }`, чтобы закрепить id для следующих запусков.
- **Веб-URL:** `https://cddisk.gptz.lad-soft.ru/docs` = «Мои документы» (без числа в адресе); `https://cddisk.gptz.lad-soft.ru/docs/50` = папка id=50. Передавайте в tool как `web_url`.
- **Разделы меню:** `disk_section`: `docs`, `shared_to_me`, `common`, `favorites`, `recent`, `file_depot` и др. (см. `section_roots` после login).
- **Создать папку:** `r7_disk_login` → **один** `r7_disk_folder` по шаблону `folder_create_example` из ответа login (`auth_token` + `parent_directory_id` + `name`). Без `auth_token` кэш между tool-вызовами часто пуст.
- **Запрещено:** перебирать id 1, 22, 50 «наугад»; использовать «Общие» как личный корень без явного запроса.

### Пустой диск vs нет хранилища (`storage_state`)

| `storage_state` | Что сказать | Действие |
|-----------------|-------------|----------|
| `personal_empty` | «Мои документы пусты, хранилище есть» | `folder create` по `folder_create_example` из login (auth_token + parent_directory_id) |
| `personal_with_content` | Обычная работа | `r7_disk_browse` для всех файлов; `list_directory` — одна папка |
| `no_personal_only_shared` | «Личного корня нет, есть расшаренные папки» | `create_target` или имя папки; не говорить «нет доступа к диску» |
| `no_accessible_roots` | Эскалация админу Р7 | `R7_DISK_DEFAULT_PARENT_DIRECTORY_ID` |

Пользователю не показывайте числовые ID без необходимости (достаточно имён и `web_url_hint`).

Эндпоинты навыка: `/api/v2/auth/Login`, `/api/v1/DocumentDirectory/*`, `/api/v1/Documents/*` (см. [reference.md](reference.md)). Swagger API — отдельный раздел документации; `/docs/50` в веб-UI диска — **папка пользователя**, не Swagger.

**Не использовать для «Мои документы»:** `GET api/2.0/crm/files/root` ([документация CRM](https://support.r7-office.ru/community_server/api/settings-api/crm-api/files-api/poluchit-identifikator-kornevoj-pap/)) — это **корень файлов модуля CRM** на портале Community Server (`yourportal.r7-office.ru`), другой хост и другая авторизация. На `cddisk.gptz.lad-soft.ru` этот путь возвращает **405**. Личный корень Диска ищется через `DocumentDirectory/Get` и быстрый скан id 2–128 после login.

Перед publish добавьте хост из `R7_DISK_BASE_URL` в `resources.network.hosts` каждого скрипта (см. `scripts/*.meta.md`).

## Правила ответа агента (обязательно)

### Минимум шагов и размышлений

| Запрещено | Вместо этого |
|-----------|--------------|
| `skills list_active` и прочие meta-tools | Сразу `r7_disk_login` → `r7_disk_browse` |
| Долгие рассуждения перед tool | Один короткий план → вызов tool |
| Повторный `r7_disk_login` после `ok: true` | `browse` / `list_directory` с авто-токеном |
| `list_directory` корня и стоп | **`r7_disk_browse`** — файлы в подпапках |

**«Какие файлы на диске» / «покажи файлы»** — максимум **2 tool** в новой сессии:

1. `r7_disk_login` с `credential_source: "environment"` (если ещё не входили).
2. **Один** `r7_disk_browse` с `my_documents_directory_id` из ответа login (или `{}` если KV работает).

Покажи таблицу из **`all_documents`** (`name`, `folder_path`, `size`). **Не** ограничивайся списком подпапок корня.

Если KV между вызовами пуст — передайте из login: `my_documents_directory_id`, `auth_token`.

### Скачивание и просмотр содержимого (читать первым)

| Запрос пользователя | Tool | Параметры |
|---------------------|------|-----------|
| «Скачай файл» | **`r7_disk_download`** | `directory_id` + `name` |
| «Покажи содержимое» / «покажи текст» / «что в файле» | **`r7_disk_document`** `read_content` | `operation: read_content`, `directory_id`, `name` |

**Не путай просмотр и скачивание.** «Покажи текст» → **только** `read_content`. **Никогда** не вызывай `r7_disk_download` для просмотра.

**Скачивание — только `r7_disk_download`.** Не вызывай `r7_disk_document` с `operation: download` — на платформе параметры могут не дойти до handler.

### Показать текст файла — один вызов, стоп

Запрос: «покажи текст», «содержимое», «первый документ» → **ровно один** `r7_disk_document`:

```
r7_disk_document {
  operation: "read_content",
  directory_id: 94,
  name: "ТЗ.docx"
}
```

| Запрещено после read_content | Почему |
|------------------------------|--------|
| Повторный `read_content` | `do_not_retry`, dedup в skillStorage |
| `r7_disk_list_directory` | Имя и id уже известны из контекста |
| `r7_disk_download` | Пользователь не просил «скачай»; текст в виджете `documentContentCard` |
| `get_id_by_name` / `exists` | Лишний шаг |

Если в предыдущем шаге уже был `list_directory` — возьми **имя первого файла** из `documents[]` и вызови **один** `read_content`. **Не** вызывай `list_directory` снова.

После `ok: true` — текст в карточке **`documentContentCard`**; агенту — `log_text_preview` / `content_text`. **Стоп** (`agent_stop: true`). Пустой `{}` в логе — не ошибка.

Запрос: «Скачай …» → **максимум 2 tool**: `r7_disk_login` (если нужен) + **один** `r7_disk_download`:

```
{ "directory_id": 42, "name": "тестовый.txt" }
```

После `ok: true` пользователь видит **кнопку «Скачать файл»** в виджете. Ответ в чат (1 предложение): «Нажмите „Скачать файл“ в карточке». **Стоп** — не повторяй вызов.

| Запрещено | Почему |
|-----------|--------|
| `r7_disk_document` + `operation: download` | Используй **`r7_disk_download`** |
| Только `document_id` без `name` | Нужны `directory_id` и `name` |
| Повторный download в той же сессии | `do_not_retry: true` |
| Выдумать `download_link` при `ok: false` | Сообщи `error` дословно |

**Если `error` содержит «Не задан operation»** — вызван не тот tool. Для скачивания — **`r7_disk_download`**, для текста — `r7_disk_document` + `operation: read_content`.

**Запрещено выдумывать содержимое файла.** Цитируй **только** `content_text` из `read_content`.

### Не выдумывать данные (все tools)

Если в ответе tool есть **`do_not_invent_content: true`** — показывай пользователю **только** поля из **`cite_only_fields`** (и `agent_message`). Не дополняй списки файлов, id папок, ссылки и текст документов «из памяти».

| Tool | Цитируй только |
|------|----------------|
| `list_directory` | `folders`, `documents`, `listing_scope_note` |
| `browse` | `tree_text`, `all_documents`, `all_folders` |
| `login` | `my_documents_directory_id`, `accessible_directory_roots`, `create_target`, `storage_state` |
| `folder` create | `created_folders`, `folder_id`, `folder_name` |
| `document` read_content | `content_text` |
| `document` append/prepend | `content_text_verified` (если есть), иначе только `agent_message` |
| `document` download | `web_ui_url` / `download_link`, не содержимое файла |

Если нужных полей нет или `ok: false` — скажи об ошибке, **не** придумывай содержимое.

### Формат ответа

1. **Только то, что спросил пользователь** — без «итогов сессии», таблиц «все задачи ✅», списков из 10+ пунктов прошлых шагов, «All tasks completed», эмодзи-чеклистов.
2. **Без размышлений в чате** — не показывай ход мыслей, цитаты SKILL.md, английские заметки (`Ready to execute`, `According to the instructions`, `Let me verify`, `Let me try again`).
3. **Один вызов tool на одну задачу.** После `ok: true` + `do_not_retry: true` + `agent_stop: true` — **стоп**. Не повторяй тот же tool.
4. **Пустой `{}` в логе** при download — **успех**; смотри `tool_log_summary`, `agent_message`, `log_text_preview` — **не** повторяй download.
5. **Не отвечай до tool** — один финальный ответ после успешного вызова.
6. **Тип файла** — по расширению (`Отчёт.docx` → DOCX), не по `MimeType` API.

### Запрещённые действия после записи

После `create`, `upload`, `append`, `prepend`, `replace`, `rename`, `move`, `copy`, `delete`, `versions`, `get_id_by_name`:

- **НЕ** вызывай `download` (пользователь не просил «скачай»).
- **НЕ** вызывай `list_directory` «для проверки».
- В ответе tool: `show_download_widget: false`, `forbid_followup_tools` — **не показывай** карточку «Скачать файл».

Сообщи только `agent_message` (1–3 предложения).

### Скачивание — только по запросу «скачай»

**Критично:** за один запрос — **ровно один** вызов **`r7_disk_download`**. Повтор **запрещён**.

Пользователь назвал файл — **не** делай `list_directory`, **не** `get_id_by_name`:

```
r7_disk_download {
  directory_id: 42,
  name: "тестовый.txt"
}
```

После `ok: true` — **стоп**. Пользователь нажимает «Скачать файл» в виджете.

Всегда передавайте **`directory_id` папки** вместе с `name`.

Имя в карточке = реальное `file_name` (например `Заметка_переименована.txt`), не `.bin`.

### Дерево папок — только `r7_disk_browse`

| Запрос | Tool | Параметры |
|--------|------|-----------|
| «дерево папок», «структура каталогов», «начиная с X» | `r7_disk_browse` | `folder_name: "X"` или `folder_path: "X/Подпапка"` |
| «что в одной папке» | `r7_disk_list_directory` | id из списка по имени |

Для «дерево … начиная с Ladcraft_Проверка»:

```
r7_disk_browse { "folder_name": "Ladcraft_Проверка" }
```

Покажи пользователю поле **`tree_text`** (и при необходимости таблицу `all_folders`). **Не** используй только `list_directory` — он не строит дерево вложенности.

### Быстрые операции без лишних шагов

| Запрос | Один вызов |
|--------|------------|
| ID файла по имени | `r7_disk_document` `get_id_by_name` |
| Дописать в конец/начало | **Один** `append` / `prepend` — без download, без list, без «проверю содержимое» |
| **Показать содержимое файла** | **Один** `read_content` с `directory_id` + `name` — **не** `download`, **не** повторный list |
| «Первый документ» в папке | Имя из `documents[0]` предыдущего list → **один** `read_content` |
| Пустой `.txt` | `create` с `name: "….txt"` |
| Создать `.docx` с текстом | **Один** `create` с `content_text` — не `create` + `prepend` |

После `append`/`prepend`/`create`/`get_id_by_name`/`read_content`: передай смысл **`agent_message`** и **`content_text`** (для read_content), **не вызывай `r7_disk_document` повторно** (`do_not_retry`, `agent_stop`).

## Pipeline

```
Task Progress:
- [ ] Шаг 1: r7_disk_login (если ещё нет токена)
- [ ] Шаг 2: list / browse / folder — по задаче пользователя
- [ ] Шаг 3: Показать результат в читаемом виде (без дублей tool)
```

### Шаг 1 — Авторизация

**Обязательно, если в установке навыка заданы `R7_DISK_*`:** не вызывай `r7_disk_login` сразу. Спроси пользователя:

1. **Использовать сохранённые переменные** (тот диск, что в настройках навыка) → `credential_source: "environment"`.
2. **Войти на другой диск** → попроси `base_url`, `login`, `password` → `credential_source: "custom"` и эти параметры.

Если вызвать `r7_disk_login` без `credential_source` при заполненном environment, tool вернёт `needs_credential_choice: true` и `environment_preview` — это сигнал задать вопрос, а не ошибка сети.

После выбора вызови `r7_disk_login` с нужным `credential_source`. При успехе — `auth_token`, `user`, `modules_access`.

Убедись, что в `modules_access` есть `"Disk"`. Если модуля нет — у пользователя нет доступа к диску.

Токен и id корня «Мои документы» кэшируются в `skillStorage` и переиспользуются следующими вызовами (в т.ч. в **новом** чате агента). Остальные tools по-прежнему могут авто-login из environment, если пользователь уже выбрал «сохранённые» на шаге 1.

**Не вызывай `r7_disk_login` повторно** в той же сессии после успешного входа. Для списка файлов, чтения и скачивания используй `list_directory` / `read_content` / `download` — у них авто-токен из KV (`auth_from_cache: true`, `forbid_followup_tools` содержит `r7_disk_login`).

**Если `my_documents_directory_id` пуст после login:**

1. Повтори login с `anchor_directory_id` — id любой известной подпапки внутри «Мои документы» (пользователь назвал id папки или URL `/docs/N`).
2. Или открой подпапку через `list_directory` с `directory_id`, возьми `parent_directory_id` / `parent_chain` корня «Мои документы».
3. Вызови **`r7_disk_set_my_documents_directory_id`** с найденным id корня — **один раз**, затем работай через `list_directory` без `directory_id`.

**Запрещено:** перебирать id=1, 2, 3, 4, 22, 50 «наугад» (типичная ошибка агента); не вызывать `set_my_documents_directory_id` без проверки (родитель подпапки или успешный Get корня).

**Правильно при `root_not_found`:** один `browse` с `folder_name` **или** один вопрос пользователю — не 6× `list_directory` с разными id.

### Расшаренные файлы («Доступно для меня»)

Запросы «что мне расшарили», «файлы от коллег», «доступно для меня»:

```
r7_disk_list_directory {
  disk_section: "shared_to_me",
  auth_token: "<из login>"
}
```

Или `web_url: "https://cddisk.example.ru/shared-to-me"`.

**Важно:** файлы в этом разделе имеют `DirectoryId` исходной папки владельца (не id=62). Навык **не фильтрует** их в виртуальных разделах. В ответе смотрите `documents`, `document_id`, `owner_directory_id`, `Author`.

**Дописать в расшаренный файл** (`prepend` / `append` / `read_content`) — передайте **`document_id` и `directory_id` (DirectoryId)** из листинга, не только имя:

```
r7_disk_document {
  operation: "prepend",
  document_id: 45,
  directory_id: 11,
  name: "Обряд.docx",
  content_text: "Согласовано",
  auth_token: "<из login>"
}
```

Папка владельца (id=11) может вернуть HTTP 406 при прямом `list_directory` — это нормально. Операции идут по `document_id`. При `ok: false` **не** сообщайте пользователю об успехе.

| Раздел | `disk_section` |
|--------|----------------|
| Доступно для меня | `shared_to_me` |
| Совместный доступ | `shared_access` |
| Общие | `common` |

### Шаг 2 — Просмотр содержимого

**Одна папка:** `r7_disk_list_directory`

- `directory_id` **не обязателен** — без него корень `disk_section` (по умолчанию `docs` = «Мои документы» после login).
- Можно передать `web_url` (`/docs` или `/docs/50`) вместо `directory_id`.
- Ответ: `folders`, `documents`, `listing_scope_note`, `is_empty`, `storage_state`, `create_target`, `parent_chain`, `scope_warning`.
- Файлы в `documents` **только этой папки** (фильтр по `DirectoryId`). Пустая подпапка «Привет» id=52 → `documents: []`, не файлы из корня id=42.

### Навигация по папкам (критично — частая ошибка агента)

**`list_directory` показывает одну папку, а не весь диск.** Пустой ответ означает «в этой папке пусто», а не «на диске ничего нет».

| Запрос пользователя | Действие агента |
|---------------------|----------------|
| «Мои документы», «все папки», «перечень папок» | `list_directory` или `browse` без `directory_id` |
| «Какие файлы», «что на диске», «покажи файлы» | **`r7_disk_browse`** — `all_documents` с `folder_path` |
| «Дерево папок», «структура», «начиная с X» | **`r7_disk_browse`** с `folder_name: "X"` — показать `tree_text` |
| «Что в папке Ладкрафт» | Сначала `list_directory` (корень), найти Id папки «Ладкрафт», затем `list_directory` с этим id — **не** спрашивай id у пользователя |
| «Папка Новая» | По имени из `folders[]` или `web_url` `/docs/N` |
| URL из браузера `/docs/50` | `list_directory` с `web_url` — не проси id у пользователя |

**Запрещено:**

- говорить «диск пустой» / «нет доступа», если `storage_state=personal_empty` (это пустое хранилище, не ошибка);
- говорить «диск пустой» / «других папок нет», если смотрели только одну чужую `directory_id` (например 11 или 22);
- перебирать id каталогов без `parent_chain` / login;
- отвечать «я уже показал», если пользователь сменил область («Мои документы» ≠ «Новая»);
- утверждать содержимое папки X **без** свежего `list_directory` с `directory_id` этой папки;
- путать ответ до tool и после tool (сначала «пусто», потом «3 подпапки» — значит первый ответ был ошибочным, исправь явно).

**После каждого `list_directory` в ответе пользователю укажи:**

1. `listing_scope_note` или строку: «Папка „Имя“ (id=N)»;
2. если есть `parent_directory_name` — «родитель: …»;
3. таблицы `folders` и `documents` **только этой** папки.

**Все документы на диске (не только одна папка):** `r7_disk_browse`

- Корень обхода — «Мои документы» **автоматически** (`directory_id` не нужен).
- **Глубину обхода пользователь не настраивает** — навык сам использует `max_depth: 5` (достаточно для обычного дерева папок).
- В ответе смотри **`all_documents`** — плоский список всех файлов с полем `folder_path` (путь к папке).
- Для запросов «все файлы», «что на диске», «перечень документов» — **всегда** `browse`, не `list_directory` (он только одна папка).

Пример (достаточно `directory_id`; `max_depth` не спрашивай у пользователя):

```
r7_disk_browse {}
```

Покажи пользователю таблицу из `all_documents`: `id`, `name`, `folder_path`, `size`, `mimeType` и итог `total_documents`.

**Дерево папок:** `r7_disk_browse`

- По умолчанию глубина **5** уровней (в коде, без полей в установке навыка).
- Параметр `max_depth` — только для агента при очень глубоких деревьях; **не** предлагай пользователю его заполнять.
- Корень по имени: `folder_name` (например `Ladcraft_Проверка`) или `folder_path` (`Ladcraft_Проверка/Отчёты`) — **без** `directory_id` от пользователя.
- В ответе tool: **`tree_text`** — готовое дерево для чата; **`do_not_retry: true`** — не вызывай browse повторно.

### Шаг 2б — Управление папками (`r7_disk_folder`)

**Создать папки — 2 шага, без экспериментов (читать первым при «создай папку/папки»):**

1. **Один** `r7_disk_login` (если ещё не было успешного входа в этой задаче).
2. **Один или несколько** `r7_disk_folder` `create` — скопируйте поля из ответа login:

```
r7_disk_folder {
  operation: "create",
  auth_token: "<из login>",
  parent_directory_id: <create_target.parent_directory_id>,
  name: "Имя_папки"
}
```

**Несколько папок** — предпочтительно **один** вызов с `names`:

```
r7_disk_folder {
  operation: "create",
  auth_token: "<из login>",
  parent_directory_id: 61,
  names: ["Рабочие", "Фото", "Архив", "Проекты", "Личное"]
}
```

| Симптом ошибки | Единственное действие | Запрещено |
|----------------|----------------------|-----------|
| HTTP **406** на create | Login → create с `auth_token` + `parent_directory_id` из login | Считать «нет прав», пробовать `web_url`, `disk_section`, другие разделы |
| «Не найден родительский каталог» | Передать `parent_directory_id` и `auth_token` из login | Повторять create без parent, вызывать `list_directory` «для проверки» |
| `do_not_retry: true` | Остановиться, сообщить `error` | Перебирать варианты параметров |

**Не вызывайте `r7_disk_folder` до `r7_disk_login`** — без токена HTTP 406 на AddSubDirectory выглядит как «проблема с parent», но это отсутствие авторизации.

| action | Параметры | API |
|--------|-----------|-----|
| `create` | `auth_token` + `parent_directory_id` + `name` **или** `names[]` **или** `folder_path` (`"A/B/C"`) | POST AddSubDirectory |
| `move` | `folder_id`, `to_directory_id` | GET Move |
| `copy` | `folder_id`, `to_directory_id`, `rule` (0/1/2) | GET Copy |
| `delete` | `folder_id` | DELETE Delete |
| `restore` | `folder_id` или `folder_ids` | POST Restore |
| `conflict` | `folder_id`/`folder_ids`, `to_directory_id` | POST Conflict |
| `rename` | `folder_id`, `name` | **Невозможно** — `ok: false`, `impossible: true`; не предлагай обходной путь без запроса пользователя |

**Переименование папки:** действие **невозможно** в API. При `r7_disk_folder` action `rename` сообщи пользователю коротко и не вызывай `r7_disk_document rename` для папок. Файлы — только `r7_disk_document` + `rename` + `document_id`.

**Создание подпапок:** `folder_path: "Отчёты/2026/Январь"` создаёт цепочку внутри `parent_directory_id`; в ответе — `created_folders` и итоговый `folder_id`.

**Копирование (`rule`):** `0` — ошибка при конфликте имён; `1` — перезапись; `2` — автопереименование (уточните у администратора при сомнениях).

Перед удалением по возможности покажи содержимое папки через `r7_disk_list_directory`.

### Шаг 2в — Файлы и документы (`r7_disk_document`)

**Запрещено:** создавать файлы через pip, python-docx, локальный Python или shell на машине агента. **Только** `r7_disk_document`.

**Критично:** в каждом вызове передавайте **`operation`** (create, read_content, append…). Без `operation` платформа может отдать handler пустой `{}` → ошибка «Не задан operation».

**Создать файл в папке** (папка уже есть, например id=60):

```
r7_disk_document {
  operation: "create",
  directory_id: 60,
  name: "Важное.docx",
  content_text: "Что же самое важное?"
}
```

**Один вызов `create` с `content_text` — и стоп.** Не создавайте пустой файл и не вызывайте `prepend`/`append` отдельно. После `ok: true` передайте пользователю `agent_message` — **не** вызывайте `r7_disk_document`, `list_directory` и другие tools для проверки (`forbid_followup_tools`, `agent_stop: true`).

### Показать содержимое файла (`read_content`) — не download

Запросы «дай содержимое», «что в файле», «покажи текст», «покажи текст первого документа» → **один** **`read_content`**, не `download`, не повторный `list_directory`.

**«Первый документ»:** если папка уже показана — `documents[0].Name` + `directory_id` → один `read_content`. Не перечисляй папку снова.

**Имя файла без расширения (`Привет1`):** если в папке **один** файл с таким именем — подставится автоматически (`Привет1.docx`). Если файлов **несколько** (`Привет1.docx`, `Привет1.txt`) — tool вернёт `needs_name_clarification` и список `candidate_names`; **спросите у пользователя**, какой файл имелся в виду. Не выбирайте расширение сами.

```
r7_disk_document {
  operation: "read_content",
  directory_id: 42,
  name: "Привет1.docx"
}
```

- Ответ: `content_text` (до 12000 символов), `content_truncated`, `total_chars`, `log_text_preview`.
- Виджет **`documentContentCard`** — текст файла в карточке (`show_content_widget: true`). **Без** виджета скачивания (`show_download_widget: false`).
- **Пустой `{}` в логе** без `ok: false` — **успех** (как у download). Смотри `tool_log_summary` (`READ_OK:…`), `agent_message`, **`log_text_preview`** — **не** повторяй `read_content`, **не** вызывай `download`/`exists`/`get_id_by_name`.
- Выводи **дословно** `content_text` или `log_text_preview`; поле `content_preview` — проверка, не пересказывай («Привет, мир» и т.п. запрещено).
- Пользователь уже видит текст в карточке — кратко подтверди в чате, не дублируй весь документ без необходимости.
- Карточка **`documentContentCard`** — **один раз** на файл (`widget_render_once`); повторный `read_content` не дублирует виджет.
- `download` — **только** если пользователь явно просит **скачать** файл.

### Правка файла после просмотра (`prepend` / `append`)

Запросы «добавь в начало», «допиши», «вставь текст» → **один** `prepend` или `append`. **Не** вызывай `read_content` снова — навык сам скачает файл и сохранит старый текст.

`directory_id` и `document_id` — из **`all_documents`** последнего `browse` (поля `directory_id`, `id`). Если был `browse`, достаточно `name` + `content_text`.

```
r7_disk_document {
  operation: "prepend",
  name: "Шаблон.docx",
  content_text: "**{26}Согласовано**\n\n"
}
```

Для `.docx` в `content_text` поддерживается разметка (как при `create`):

| Разметка | В Word |
|----------|--------|
| `**текст**` | жирный |
| `*текст*` | курсив |
| `**{26}текст**` | жирный, размер 26 pt |
| перенос строки | новый абзац |

«Добавь в начало жирным 26 размером Согласовано» → `content_text: "**{26}Согласовано**\n\n"`. Без звёздочек — обычный текст.

### Дописывание (`prepend` / `append`) — без подмены содержимого

В API Р7-Диска **нет** отдельного метода «дописать в конец/начало». Навык делает **слияние**: скачивает файл, добавляет **только** переданный `content_text` в начало или конец, **сохраняя весь старый текст**, затем загружает результат. Это **не** `replace`: в ответе tool — `content_preserved: true`, `full_content_replace: false`.

Если пользователь просит «дописать / вставить в начало / в конец»:

- **в начало** → `operation: "prepend"` (`document_id` + `directory_id` + `name` + `content_text`; для расшаренного — id из `shared_to_me`)
- **в конец** → `operation: "append"`
- **не** предлагай резервную копию и **не** используй `replace` для дописывания
- при ясном запросе — **ровно один** вызов `prepend` или `append`, затем **стоп**
- **Пустой `{}` в логе** без `ok: false` — **успех** (как у download). Смотрите `tool_log_summary` (`PREPEND_OK:…`) и `agent_message`. **Не** повторяйте tool.
- не цитируй в чат правила подтверждения — для append/prepend подтверждение **не** требуется

**Запрещено после успешного prepend/append** (лишние действия агента):

| Лишний вызов | Почему |
|--------------|--------|
| `read_content` «для проверки» | Запись уже проверена внутри навыка (`content_verified`); в ответе `forbid_followup_tools` |
| Повторный `prepend` / `append` | `do_not_retry: true` |
| `list_directory` по `DirectoryId` владельца (например 11) | HTTP 406 — нет доступа к папке владельца; это **не** признак ошибки записи |
| `r7_disk_login` снова | Токен уже в кэше |
| Длинные размышления «не могу подтвердить» | При `{}` без ошибки — сообщите `agent_message`, не сомневайтесь |

**Расшаренный файл «Обряд.docx»:** один `prepend` с `document_id` и `directory_id` из предыдущего `list_directory` (`disk_section: shared_to_me`). Ответ пользователю: «В начало файла добавлено: …» — 1 предложение.

| Можно (prepend/append) | Нельзя — только replace+копия или вручную |
|------------------------|-------------------------------------------|
| Новый текст в **начало** или **конец** | Вставка/правка **в середине** |
| `**жирный**` / `*курсив*` у **нового** текста | Изменить форматирование **существующего** текста |
| `.txt`, `.md`, `.docx` | «После заголовка», «сделай жирным фразу X» в середине |

### Полная замена (`replace`) и резервная копия — только если prepend/append не подходят

Сценарий **copy → replace** и подтверждение **только** когда нужно:

- правка **в середине** документа;
- изменить **существующий** текст (жирный, курсив, замена фразы);
- пользователь дал **полный** новый текст файла целиком;
- вставка «после N-го абзаца» и т.п.

1. Сообщи: «Такое изменение возможно только полной перезаписью (`replace`)».
2. Предложи резервную копию перед `replace`.
3. После «да»: `copy` → `replace` с **полным** новым содержимым.
4. Без согласия на `replace` — ручная правка в Р7-Офис.

`replace` с частичным текстом **уничтожит** остальной файл.

**Важно:** не заявляй об изменении, пока нет `ok: true` и полей `content_preserved` / `agent_message`.

### Режим подтверждения (не для prepend/append)

**Без** длинного подтверждения и копии: `prepend`, `append` (если ясен вставляемый текст); `create`, `upload` нового файла.

**С** подтверждением до tool: `replace`, цепочка `copy` → `replace`; `delete`; правка **середины** / **существующего** форматирования.

**Критично:** не вызывай `replace` в том же ответе, где спросил про резервную копию.

Пример (жирный заголовок в начало DOCX):

```
r7_disk_document {
  action: "prepend",
  directory_id: 12,
  name: "f1.docx",
  content_text: "**Привет всем!**\n\n"
}
```

**Создать файл с текстом (типичный запрос пользователя):**

```
r7_disk_document {
  action: "create",
  directory_id: 12,
  name: "Отчёт.docx",
  content_text: "Текст документа на русском"
}
```

Для `.docx` с текстом навык собирает DOCX локально (ZIP в JS, **без сети** и без pip) и загружает через `upload`. В `content_text` для DOCX: `**жирный**`, `*курсив*`, переносы строк — новый абзац. Для `.txt` — plain UTF-8. Пустой файл — `create` без `content_text`.

Пример DOCX с жирным: `content_text: "Обычный **жирный** текст"`, `name: "Отчёт.docx"`.

| action | Назначение | Ключевые параметры |
|--------|------------|-------------------|
| `create` | Пустой или с содержимым | `directory_id`, `name`; опц. `content_text` / `content_base64` |
| `upload` | Загрузить файл | `directory_id`, `file_name`, `content_text` или `content_base64` |
| `prepend` | Дописать в **начало** (старый текст сохраняется) | `directory_id`, `name`, `content_text`; опц. `document_id` |
| `append` | Дописать в **конец** (старый текст сохраняется) | то же |
| `replace` | **Полная** замена содержимого (только если prepend/append не подходят; с копией) | `directory_id`, `name`, полный `content_text`/`content_base64` |
| `rename` | Переименовать | `document_id`, `name` |
| `move` | Переместить в папку | `document_id` или `document_ids`, `to_directory_id` |
| `copy` | Копировать в папку | `document_id`, `directory_id` |
| `delete` | Удалить | `document_id` или `document_ids` |
| `restore` | Восстановить из корзины | `document_id` или `document_ids` |
| `exists` | Есть ли файл с именем | `directory_id`, `name` |
| `get_id_by_name` | ID по имени в папке | `directory_id`, `name` |
| `read_content` | Показать текст в чате | `directory_id`, `name`; для .txt/.md/.docx |
| *(скачивание)* | **`r7_disk_download`** (отдельный tool) | `directory_id` + `name` |
| `versions` | Список версий | `document_id` |
| `change_version` | Активировать версию | `document_id`, `file_id` |
| `convert` | Конвертация | `document_id`, `convert_type` |

**Upload (кириллица):** для текстовых файлов предпочитай `content_text` (UTF-8), не base64. Имя с расширением передаётся в `file_name` (`Тест.txt`). Тело multipart отправляется бинарным `Uint8Array`, имя — по RFC 5987 (`filename*=UTF-8''…`).

**Upload (бинарные):** `content_base64` — чистый base64 или data-URL.

**Скачивание:** tool **`r7_disk_download`** — кнопка «Скачать файл» в виджете (до **5 МБ**).

### Варианты по типу файла

**Перед скачиванием** — один вызов **`r7_disk_download`**; виджет покажет кнопку.

**Перед `append` / `prepend` / `create`** — **не** спрашивай варианты и **не** перечисляй возможности; сразу один вызов tool.

Перед `replace` или правкой **середины** — кратко предложи replace с копией (см. режим подтверждения).

**Скачивание («скачай», «дай файл»):**

| Тип файла | Что возможно | Что сказать пользователю |
|-----------|--------------|---------------------------|
| `.txt`, `.md`, `.csv`, `.json` | **`r7_disk_download`** — кнопка в виджете | Для текста в чате — `read_content` |
| `.docx` и др. офисные | **`r7_disk_download`** | «Показать текст» — `read_content` |
| Просмотр содержимого | **`read_content`** | **Запрещён** download и выдумывание текста |

**Изменение текста в существующем файле:**

| Тип | Дописать в начало/конец | Полная перезапись + копия |
|-----|-------------------------|---------------------------|
| `.txt` | `prepend` / `append` — **сразу**, без копии | Только если нужна правка **середины** или полный новый текст → `copy` → `replace` |
| `.docx` | `prepend` / `append` (**новый** текст с `**` / `*`) — **сразу** | Правка середины / существующего форматирования → `copy` → `replace` или вручную |
| Любой | «В начало/конец» → один `prepend`/`append` | «После заголовка», «сделай жирным X» → объясни лимит API → только `replace`+копия или вручную |

**Шаблон перед `replace` или правкой середины** (не нужен для простого prepend/append):

```text
Для «Имя.docx» дописать в начало/конец могу без перезаписи (prepend/append).
Для изменения середины / существующего текста — только replace целиком с резервной копией.
Какой вариант? (1 — дописать … / 2 — replace с копией / 3 — вручную)
```

После выбора: **1** → один `prepend`/`append`; **2** → `copy`, затем `replace`.

**Доставка файла пользователю:**

| Способ | Tool | Что говорить |
|--------|------|--------------|
| **Кнопка в виджете** | **`r7_disk_download`** | «Нажмите „Скачать файл“ в карточке» |

### Скачивание: один вызов, без дублей (критично)

**Успех** — `ok: true`, `show_download_widget: true`. **Стоп** — не повторяй.

При «скачай»: **один** **`r7_disk_download`** с `directory_id` и `name`.

Пример:

```
r7_disk_download {
  directory_id: 42,
  name: "тестовый.txt"
}
```

Пример просмотра:

```
r7_disk_document {
  operation: "read_content",
  directory_id: 42,
  name: "Привет1.docx"
}
```

### Шаг 3 — Формат ответа пользователю

Покажи:

- имя текущей папки и путь через `parent`;
- таблицу подпапок: `Id`, `Name`, `Size`, `Timestamp`;
- таблицу документов: `Id`, `Name`, тип по **расширению** (не слепо `MimeType` API), `Size`, `Date`;
- если папка пуста — явно сообщи об этом.

Не выводи `auth_token`, пароль и полный JSON без запроса.

## Типичные ошибки

| Симптом | Действие |
|---|---|
| `401 Unauthorized` | Проверь логин/пароль, срок `ExpiredAt`, повтори login |
| Не найдены «Мои документы» | `r7_disk_login` с `anchor_directory_id` или `web_url` подпапки; или `list_directory` по id подпапки → `set_my_documents_directory_id` с id родителя |
| Корень найден в диалоге, но не запомнился | `r7_disk_set_my_documents_directory_id` с `{ "directory_id": N }` |
| `storage_state: personal_empty` | Нормально — `folder create` по `folder_create_example` из login |
| HTTP 406 на folder create | Нет/устарел `auth_token` — login, затем create с `auth_token` + `parent_directory_id` |
| «Не найден родительский каталог» | Передайте `auth_token` и `parent_directory_id` из login; не перебирайте `web_url`/`disk_section` |
| Долгие размышления при create | Строго 2 шага: login → folder с `folder_create_example`; запрещены list/browse для диагностики |
| «Доступно для меня» пусто, в UI есть файлы | Обновите навык: расшаренные файлы не фильтруются по DirectoryId; вызов с `disk_section: shared_to_me` |
| Чужие файлы в ответе | Проверь `scope_warning` и `parent_chain`; не угадывай id |
| Пустой `Children` | Нормально для **этой** папки; для корня — `list_directory` без `directory_id` |
| «Диск пустой», но есть Ладкрафт | Смотрели подпапку вместо корня; вызови `list_directory` без `directory_id` |
| Две карточки / «не получилось» при видимой кнопке | Смотри `download_ready` и `download_status` — при успехе опиши итог пользователю, не вызывай tool снова |
| Сначала «пусто», потом данные | Не отвечай до tool; при исправлении скажи: «ранее смотрел другую папку» |
| «Дерево папок» — только list, папка «пустая» | Нужен `r7_disk_browse` + `folder_name`, вывод `tree_text` |
| Tool вызван дважды подряд | Смотри `do_not_retry` и `agent_message`; не повторяй при `ok: true` |
| DOCX в UI как «doc», ошибка открытия | Тип в чате — по `.docx`; пересоздай файл после обновления навыка (улучшенный DOCX) |
| «Дай содержимое» — виджет .bin | Используй **`read_content`**, не `download` |
| Карточка скачивания после append/prepend | Не вызывай download; `show_download_widget: false` |
| Append «успешен», текст не в файле | Навык проверяет содержимое после upload; при `content_verified: false` — сообщи об ошибке |
| 17 карточек / зависание на download | Один download; пустой `{}` ≠ ошибка; повтор блокируется в навыке |
| Пустой `{}` после prepend/append | Успех — `tool_log_summary: PREPEND_OK:…`; не вызывай read_content/list_directory |
| list_directory id=11 после правки расшаренного | Лишнее; 406 на папке владельца — нормально |
| Карточка `document-35.bin` | Нет `name` в download — только `directory_id` + `name`; не `versions` |
| «Выберите файл» при названном файле | Один download с `name` + `directory_id` |
| Ответ на 42 страницы при удалении | Один `delete` с `document_ids` или `file_names` + `directory_id`; ответ: «Удалено N файлов» |
| Заметка.txt 40 байт после append | Обновите навык (upload с Id); пересоздайте правку |

### Массовое удаление тестовых файлов

Пример: «Удали все тестовые файлы в Ladcraft_Проверка»:

1. `r7_disk_list_directory` с `directory_id` папки (или найти по имени).
2. **Один** `r7_disk_document` `delete` с `directory_id` и `file_names`: `["Заметка.txt", "Пустой.txt", …]` **или** `document_ids`: [все Id **файлов**, не папок].
3. Ответ: «Удалено N файлов: …» (до 10 имён). **Без** перечня всей сессии, **без** повторных list/delete.
| Сеть заблокирована | Хост из `R7_DISK_BASE_URL` должен быть в `resources.network.hosts`; redeploy навыка |
| Запросы на `education.demo` / не тот хост | Исправь `R7_DISK_BASE_URL` при установке; не подставляй `admin.*` как API |
| `Invalid network whitelist host` | Опубликуй навык с актуальным `hosts` в meta; хост запроса = хост из `R7_DISK_BASE_URL` |
| Login OK, затем whitelist на другой хост | Раньше list/browse не читали кэш `base_url` после login — обновите навык; в ответе смотри `api_base_url` |

## Справочник API

Полная таблица эндпоинтов: [reference.md](reference.md).
