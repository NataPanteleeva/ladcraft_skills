---
name: environment-user-example
description: Approved template для `environment.user` через `mcp_spec.tools[]` как fallback/shared-config.
mcp_spec:
  tools:
    - name: getConfiguredGreeting
      environment:
        user:
          GREETING_PREFIX:
            title: "Greeting prefix"
            format: "string"
---

# Environment user example

Навык показывает, как объявлять install-time user env для конкретного tool.

## Что делать агенту

1. Вызвать `getConfiguredGreeting`.
2. Использовать только конфиг из `environment.user`.
3. Не хранить этот конфиг в meta как publish-истину.
