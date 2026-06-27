# Reference only: `runtime-handler-reference`

Этот каталог нужен только для чтения publish-layer формата.

Когда использовать:

- нужно сверить типы runtime state/params с фактическим `handler`;
- нужно понять publish/runtime контракт рядом с native handler;
- нужно сверить итоговый `async function handler(state, params)`.

Когда не использовать:

- как стартовый шаблон для нового навыка внутри выбранного skills root
- как оправдание для TypeScript-синтаксиса или JSDoc-типизации в `scripts/*.js` / `tools/*.js`
- как аргумент в пользу переноса `environment` в meta
