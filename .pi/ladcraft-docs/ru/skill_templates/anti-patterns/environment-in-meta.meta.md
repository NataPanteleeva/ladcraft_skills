---
name: badTool
description: Anti-pattern, где environment объявлен в meta и воспринимается как publish-истина.
environment:
  user:
    API_TOKEN:
      title: API token
      format: string
schemas:
  input:
    type: object
resources:
  cpu: 0.2
  memory: 128
  timeout: 30
  network:
    hosts: []
---

Anti-pattern. В ladcraft-skills-studio environment задаётся в `SKILL.md -> mcp_spec.tools[]`.
