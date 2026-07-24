---
name: testSshConnection
description: Проверяет SSH-доступ к серверу (whoami, hostname) через SSH-gateway или paramikoSsh.
scriptFile: testSshConnection.js
schemas:
  input:
    type: object
    additionalProperties: false
    properties: {}
  output:
    type: object
    additionalProperties: false
    required:
      - ok
    properties:
      ok:
        type: boolean
      message:
        type: string
      error:
        type: string
      host:
        type: string
      port:
        type: integer
      username:
        type: string
      stdout:
        type: string
      stderr:
        type: string
      exitCode:
        type: integer
resources:
  cpu: 0.3
  memory: 256
  timeout: 90
  network:
    hosts:
      - localhost
---

Prod: HTTP `fetch` к `SSH_GATEWAY_BASE_URL` из `environment.app`. Укажите реальный hostname шлюза в `network.hosts` перед publish.
