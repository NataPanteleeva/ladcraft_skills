# Approved template: `minimal-skill`

Базовый шаблон для нового навыка в ladcraft-skills-studio.

Что можно копировать как есть:

- структуру `SKILL.md`
- skeleton `scripts/primer.meta.md`
- паттерн `scripts/primer.js` (`async function handler(state, params)`)
- plain JavaScript guard pattern из `skill-function-tutorial.md`

Что обязательно заменить:

- `name`, `description`
- текст prompt-а
- schema входа/выхода
- бизнес-логику tool

Что запрещено менять по форме:

- не переносить `environment` в meta
- не откатывать `handler` к устаревшему виду без `handler`
- не добавлять TypeScript-синтаксис, JSDoc-типизацию, `export`, `module.exports` или legacy bootstrap хвосты после `handler`
- не добавлять Handlebars blocks, если позже появится widget
