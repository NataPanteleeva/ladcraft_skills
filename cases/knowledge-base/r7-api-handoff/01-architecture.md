# Архитектура доступа к R7 Office API

## Три независимых слоя

| Слой | Что это | Вызов | Контекст |
|------|---------|-------|----------|
| **Редактор (макросы / плагин)** | Открытый Word или Cell | `Api.*` внутри `callCommand` | Документ/книга в окне редактора |
| **Plugin bridge** | Мост iframe ↔ хост | `Asc.plugin.executeMethod` | Панель плагина |
| **R7-Диск** | Файлы и папки в облаке | REST `/api/v1/...` | HTTP + AuthToken |

**Не смешивать:** Disk API управляет файлами в хранилище; редактирование текста в открытом окне — только `executeMethod` / `callCommand`.

---

## Два слоя в плагине (редактор)

| Слой | Вызов | Назначение |
|------|-------|------------|
| **Plugin API** | `Asc.plugin.executeMethod(name, args, cb)` | Готовые операции: вставка HTML, выделение, комментарий, блокировка UI |
| **Document Builder** | `Asc.plugin.callCommand(fn, …)` | Полный программный доступ: внутри `fn` — `Api.*` как в макросах |

Типичные примеры:

```js
// Plugin API — вставка HTML
Asc.plugin.executeMethod("PasteHtml", [html], () => {});

// Document Builder — чтение текста Word
Asc.plugin.callCommand(() => {
  const doc = Api.GetDocument();
  const text = doc.GetContent().GetText();
});
```

```js
// Document Builder — запись ячейки Cell
Asc.plugin.callCommand(() => {
  Api.GetActiveSheet().GetRange("A1").SetValue("значение");
});
```

Обновление UI после правок из плагина (паттерн refresh):

```js
Asc.plugin.callCommand(function () {}, undefined, true);
```

---

## Auth для R7-Диска

| Метод | Endpoint | Результат |
|-------|----------|-----------|
| POST | `/api/v2/auth/Login` | `AuthToken`, `RefreshToken` в `Response.Data.Tokens` |

Заголовки: `Content-Type: application/json`, `Authorization: <токен>`.

---

## Платформенный scope

- Матрица методов по умолчанию проверена на **desktop**; для **server** — отдельная валидация.
- VBA-набор сценариев подтверждён на **desktop и server** (2026-04-18) для параграфов, контролов и Cell smoke.
- `Api.GetWorkbook()` на Cell может возвращать **null** при рабочих `Api.AddSheet` / `Api.GetSheet`.
