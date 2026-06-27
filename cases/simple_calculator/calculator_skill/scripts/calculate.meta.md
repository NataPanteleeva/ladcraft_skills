---
name: calculate
description: Выполняет арифметическую операцию над двумя числами (add, subtract, multiply, divide).
scriptFile: calculate.js
schemas:
  input:
    type: object
    additionalProperties: false
    required:
      - a
      - b
      - operation
    properties:
      a:
        type: number
      b:
        type: number
      operation:
        type: string
        enum:
          - add
          - subtract
          - multiply
          - divide
  output:
    type: object
    additionalProperties: false
    required:
      - ok
    properties:
      ok:
        type: boolean
      a:
        type: number
      b:
        type: number
      operation:
        type: string
      result:
        type: number
      error:
        type: string
resources:
  cpu: 0.1
  memory: 64
  timeout: 10
  network:
    hosts: []
---

Детерминированный калькулятор: одна операция, точный числовой результат.
