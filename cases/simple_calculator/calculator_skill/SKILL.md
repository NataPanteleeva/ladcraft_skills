---
name: calculator_skill
description: >-
  Простой навык с детерминированным калькулятором: арифметика над двумя числами
  (+, -, *, /) без LLM-рассуждений внутри tool.
version: 1.0.0
tags:
  - demo
  - calculator
  - arithmetic
category: productivity
mcp_spec:
  tools:
    - name: calculate
  default_capabilities:
    required: []
general:
  lib:
    - runtime: nodejs@24
      code: |
        function asObject(value) {
          return value && typeof value === 'object' ? value : null;
        }
        function getString(source, key) {
          const object = asObject(source);
          if (!object) return '';
          const value = object[key];
          return typeof value === 'string' ? value : '';
        }
        function getNumber(source, key) {
          const object = asObject(source);
          if (!object) return NaN;
          const value = object[key];
          return typeof value === 'number' && Number.isFinite(value) ? value : NaN;
        }
---

Навык предоставляет инструмент `calculate` для точных арифметических операций.

## Инструмент `calculate`

Выполняет одну операцию над двумя числами:

- `a` — первое слагаемое / уменьшаемое / множитель / делимое
- `b` — второе число
- `operation` — одна из: `add`, `subtract`, `multiply`, `divide`

Возвращает `{ ok, a, b, operation, result }` или `{ ok: false, error }`.

Деление на ноль возвращает ошибку. Для целочисленных входов результат целый; для дробных — число с плавающей точкой.
