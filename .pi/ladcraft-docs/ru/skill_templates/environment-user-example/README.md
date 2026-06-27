# Approved template: `environment-user-example`

Шаблон показывает один из допустимых способов объявлять `environment.user` в ladcraft-skills-studio: через `SKILL.md -> mcp_spec.tools[]` как fallback/shared-config.

Что можно копировать как есть:

- форму `mcp_spec.tools[].environment.user`
- логику fallback к `mcp_spec`, когда `scripts/*.meta.md -> environment.user` не задан
- чтение значения через `env`

Что обязательно заменить:

- ключи env
- тексты title/description
- бизнес-логику tool

Что запрещено менять по форме:

- не создавать противоречие между `SKILL.md -> mcp_spec.tools[].environment.user` и `scripts/*.meta.md -> environment.user`
