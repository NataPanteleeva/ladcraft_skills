---
name: minimal-skill
description: Базовый approved template для навыка без VFS и widget (native handler).
mcp_spec:
  tools:
    - name: primer
---

# Minimal skill

Этот шаблон показывает минимально корректный prompt для Ladcraft в ladcraft-skills-studio.

## Когда использовать

- Нужен новый tool без VFS.
- Нужен самый безопасный старт без widget и user environment.

## Что делать агенту

1. Проверить, что вход соответствует schema tool `primer`.
2. Вызвать `primer` с объектом аргументов.
3. Вернуть результат tool пользователю без ссылок на несуществующие platform tools.

## Ограничения

- Не использовать `delegateToAgent`, `runDialog`, `workspace(...)`, `skills activate ...`.
- Не придумывать дополнительные tools вне `mcp_spec.tools[]`.
