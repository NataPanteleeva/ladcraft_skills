# Approved template: `instruction-only-example`

Шаблон для навыка, который состоит только из инструкций и не требует локальных tools.

Когда выбирать этот формат:

- навык должен только направлять агента и описывать workflow;
- внутри пакета не нужны `scripts/*.js`, `*.meta.md` и `widgets/*.MD`;
- достаточно `SKILL.md` с ясным prompt и без фиктивных локальных вызовов.

Что можно копировать как есть:

- структуру `SKILL.md`;
- разделы prompt-а с правилами и expected outcome;
- идею явного запрета на fake local tool calls.

Что обязательно заменить:

- `name`, `description`;
- предметную область навыка;
- шаги workflow и критерии результата.

Что запрещено менять по форме:

- не добавлять в prompt ссылки на локальные tools, которых нет в папке навыка;
- не вставлять `delegateToAgent`, `runDialog`, `workspace(...)`, `skills activate ...` как будто это доступные tools навыка;
- не превращать `instruction-only` шаблон в `tool-based` без добавления реальных `scripts/*.js` и `*.meta.md`.
