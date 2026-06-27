# Anti-pattern: целевой код без native `handler` («local-style»)

**Не копируй** в новые навыки скрипты, где единственный режим файла — глобали вроде `input`, `returnResult`, `returnResultInWidget` и «голое» тело **без** объявления `async function handler(state, params)`.

Это устаревший authoring-путь. Целевой контракт в ladcraft-skills-studio — **только** native handler в каждом `scripts/<tool>.js`.

Что делать:

1. Переписать tool в `async function handler(state, params) { ... }`.
2. Аргументы — из `params`; контекст — `state.environment`, `state.capabilities` и т.д. по [skill-function-tutorial.md](../../skill-function-tutorial.md).
3. См. [migraciya-navykov-ladcraft.md](../../migraciya-navykov-ladcraft.md) для таблицы соответствий.

Имя «local-style» здесь — ярлык для этого анти-паттерна в документации и диагностиках; в новых навыках используй только канонический `handler`.
