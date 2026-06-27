---
name: roast_or_toast
description: >-
  «Прожаривает или хвалит» разработчика по уровню усталости/кофеина. Демонстрирует
  второй рантайм python@3. Без побочных эффектов и без capabilities.
runtime: python@3
scriptFile: roast_or_toast.py
schemas:
  input:
    type: object
    additionalProperties: false
    properties:
      dev_name:
        type: string
      mood:
        type: string
        description: "roast | toast | auto (по уровню усталости)."
      fatigue:
        type: number
        description: Уровень усталости 0..100.
      caffeine:
        type: number
        description: Уровень кофеина 0..100.
  output:
    type: object
    additionalProperties: false
    required:
      - ok
      - line
    properties:
      ok:
        type: boolean
      mood:
        type: string
      line:
        type: string
      fatigue:
        type: number
      caffeine:
        type: number
resources:
  cpu: 0.2
  memory: 128
  timeout: 30
  network:
    hosts: []
---

Python-инструмент (runtime python@3, scriptFile обязателен): чистая генерация строки, без VFS/SQL.
