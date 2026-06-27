# general-lib-shared-helper

Approved template для shared helper-кода через `SKILL.md -> general.lib[]`.

## Когда использовать

- Несколько `scripts/*.js` используют одинаковые helper-функции.
- Нужно мигрировать CommonJS helper вида `scripts/sql_helpers.js` + `require("./sql_helpers")`.
- Нужно избежать копипасты helper-кода между tools без финальной папки `lib/`.

## Контракт

- `general.lib[]` задаётся во frontmatter `SKILL.md`, а не отдельной папкой `lib/`.
- Runtime берёт первый непустой lib-блок с совпадающим `runtime` и prepends его перед tool handler.
- Код из `general.lib[].code` становится top-level declarations для `scripts/*.js`.
- Tool-скрипты вызывают helper-функции напрямую: без `require`, `import`, `module.exports`, `exports.*` и `export`.
- Для одного runtime держите один объединённый lib-блок. Новый helper мержится в существующий block.

## Before: CommonJS helper

```javascript
// scripts/sql_helpers.js
function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase();
}

module.exports = { normalizeEmail };
```

```javascript
// scripts/findLead.js
const { normalizeEmail } = require("./sql_helpers");

async function handler(state, params) {
  return { email: normalizeEmail(params.email) };
}
```

Такой helper нельзя чинить удалением `module.exports` на месте: сначала составьте usage map всех `require("./sql_helpers")`.

## After: `general.lib[]`

```yaml
general:
  lib:
    - runtime: nodejs@24
      code: |
        function normalizeEmail(value) {
          return String(value || "").trim().toLowerCase();
        }
```

```javascript
// scripts/findLead.js
async function handler(state, params) {
  return { email: normalizeEmail(params.email) };
}
```

После переноса перепишите все tools на прямой вызов helper-функций. Удалите `scripts/sql_helpers.js` и `scripts/sql_helpers.meta.md`, если это был pseudo-tool, а не реальный tool.

Локальная папка `lib/` допустима только как временный staging во время миграции. Не оставляйте её как deploy-ready зависимость навыка.
