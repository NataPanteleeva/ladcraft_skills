---
name: runRemoteCommand
description: Выполняет shell-команду на сервере через SSH-gateway или paramikoSsh.
scriptFile: runRemoteCommand.js
schemas:
  input:
    type: object
    additionalProperties: false
    required:
      - command
    properties:
      command:
        type: string
        description: Shell-команда для выполнения на удалённом сервере.
      timeoutSeconds:
        type: integer
        description: Таймаут выполнения в секундах (1–300, по умолчанию 60).
  output:
    type: object
    additionalProperties: false
    required:
      - ok
    properties:
      ok:
        type: boolean
      exitCode:
        type: integer
      stdout:
        type: string
      stderr:
        type: string
      error:
        type: string
      host:
        type: string
      command:
        type: string
resources:
  cpu: 0.5
  memory: 256
  timeout: 120
  network:
    hosts:
      - localhost
---

Prod: HTTP `fetch` к `SSH_GATEWAY_BASE_URL` из `environment.app`. Укажите реальный hostname шлюза в `network.hosts` перед publish.
