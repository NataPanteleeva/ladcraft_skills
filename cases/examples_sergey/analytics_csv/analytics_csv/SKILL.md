---
name: analytics_csv
description: Анализ продаж по CSV на Р7 Диск — скачивает файл, строит XLSX-отчёт с 5 листами (таблицы и графики) и сохраняет в ту же папку.
version: 1.2.6
tags:
  - analytics
  - csv
  - r7-disk
  - sales
category: productivity
mcp_spec:
  default_capabilities:
    required:
      - type: key-value-storage
        scope: $USER
        operations:
          - Get
          - Set
  tools:
    - name: analytics_csv_generate_report
      description: Скачивает CSV с Р7 Диск, анализирует продажи и загружает XLSX-отчёт в ту же папку.
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
          ANALYTICS_CSV_DIRECTORY_ID:
            title: ID папки с CSV и отчётами
            format: number
            description: По умолчанию 109.
          ANALYTICS_CSV_DEFAULT_INPUT_NAME:
            title: Имя CSV по умолчанию
            format: string
            description: По умолчанию data_first_1000.csv.
          ANALYTICS_CSV_DEFAULT_OUTPUT_NAME:
            title: Имя XLSX-отчёта по умолчанию
            format: string
            description: По умолчанию отчет_продаж.xlsx.
      schemas:
        input:
          type: object
          additionalProperties: false
          properties:
            directory_id:
              oneOf:
                - type: integer
                - type: string
              description: ID папки Р7 Диск. По умолчанию 109.
            csv_name:
              type: string
              description: Имя CSV-файла. По умолчанию data_first_1000.csv.
            output_name:
              type: string
              description: Имя XLSX-отчёта. По умолчанию отчет_продаж.xlsx.
            conflict_policy:
              type: string
              description: overwrite | suffix | error. По умолчанию overwrite.
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
            summary:
              type: object
              additionalProperties: true
            sheets:
              type: array
              items:
                type: object
                additionalProperties: true
            agent_message:
              type: string
            error:
              type: string
---

# Аналитика продаж CSV → XLSX на Р7 Диск

Навык скачивает CSV из папки на Р7 Диск, считает метрики продаж и загружает отчёт `.xlsx` **в ту же папку**. Файл формируется через **openpyxl** и открывается в **редакторе таблиц Р7 Офис** (`doc.html?id=...`), а не через импорт CSV.

## Сценарий агента

Запрос: «Проанализируй продажи из data_first_1000.csv» / «Сделай отчёт по продажам».

**Один вызов** `analytics_csv_generate_report` → **стоп**.

```
analytics_csv_generate_report {
  directory_id: 109,
  csv_name: "data_first_1000.csv"
}
```

По умолчанию отчёт сохраняется как **`отчет_продаж.xlsx`** в той же папке, что и CSV. Если файл уже есть (в том числе открыт в Р7 Офис) — содержимое **обновляется in-place** через Upload с заголовком `Id` (тот же `document_id`). Пользователю с открытой вкладкой может понадобиться **F5** для отображения новых данных.

Параметры можно не передавать — используются значения из `environment.user` (`ANALYTICS_CSV_DIRECTORY_ID=109`, `ANALYTICS_CSV_DEFAULT_INPUT_NAME`, `ANALYTICS_CSV_DEFAULT_OUTPUT_NAME`).

## Формат CSV

Разделитель `;`, десятичная запятая в `price`. Обязательные колонки: `event_time`, `event_type`, `price`; также `brand`, `category_code`, `user_id`.

## Бизнес-правила event_type

| Раздел отчёта | События |
|---------------|---------|
| Сводка, Бренды, Категории, Динамика | **cart** = покупка |
| Воронка продаж | **view** → **purchase** (cart в воронку не входит) |

## Листы XLSX

1. **Сводка** — KPI (таблица, без графика)
2. **Бренды** — топ-8 + горизонтальные полосы
3. **Категории** — топ-8 + круговая диаграмма с легендой и подписями
4. **Воронка** — view / purchase + горизонтальные полосы
5. **Динамика** — агрегация по месяцам + сглаженная линейная кривая

После сборки XLSX патчится `styles.xml` и `app.xml` для совместимости с Р7 Офис.

## Подготовка (install-time)

| Переменная | Обязательность | Пример |
|---|---|---|
| `R7_DISK_BASE_URL` | да | `https://cddisk.gptz.lad-soft.ru` |
| `R7_DISK_LOGIN` | да | логин |
| `R7_DISK_PASSWORD` | да | пароль |
| `ANALYTICS_CSV_DIRECTORY_ID` | нет | `109` |
| `ANALYTICS_CSV_DEFAULT_INPUT_NAME` | нет | `data_first_1000.csv` |
| `ANALYTICS_CSV_DEFAULT_OUTPUT_NAME` | нет | `отчет_продаж.xlsx` |

Токен Р7 кэшируется в `skillStorage` между вызовами.

## Правила ответа агента

- **Диалог в два этапа:** сначала спроси, есть ли новые данные в CSV; отчёт формируй **только** после явной команды пользователя («сформируй отчёт» и т.п.).
- **Не выдумывай** цифры — цитируй только `summary` и `agent_message` из ответа tool.
- **Не** строй отчёт текстом в чате — результат только в XLSX на диске.
- После `ok: true` + `do_not_retry: true` — **стоп**, не повторяй tool.
- Сообщи пользователю: имя файла, папку, 2–3 KPI из `summary`, подсказку открыть в Р7 Офис.

## Типичные ошибки

| Симптом | Действие |
|---|---|
| `401` / нет токена | Проверь `R7_DISK_*` в настройках навыка |
| CSV не найден | Уточни `directory_id` и `csv_name` |
| `Invalid network whitelist` | Опубликуй навык с актуальным `hosts` в meta |
| Файл уже есть | In-place обновление (`upload_method: in_place_id_header`); при открытой вкладке — F5 |
