---
name: testSshConnection
description: Проверяет SSH-доступ к серверу через paramiko (whoami, hostname).
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
    hosts: []
---

Требует runtime-адаптер `paramikoSsh` (локально — dev-server + `pip install paramiko`).
