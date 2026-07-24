# Approved template: `environment-user-example`

Шаблон показывает единственно корректный способ объявлять `environment.user` для `cursor_ladcraft`: через `SKILL.md -> mcp_spec.tools[]`.

Что можно копировать как есть:

- форму `mcp_spec.tools[].environment.user`
- чтение значения через `env`

Что обязательно заменить:

- ключи env
- тексты title/description
- бизнес-логику tool

Что запрещено менять по форме:

- не переносить `environment` в `*.meta.md`
