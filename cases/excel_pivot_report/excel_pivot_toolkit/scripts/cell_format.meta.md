---
name: cell_format
description: >-
  Оформление открытого R7 Cell (плагин Asc). headerBold/headerFillRgb = первая
  СТРОКА таблицы (ряд 1), не первый столбец. Поддерживаемые format-ключи ТОЛЬКО:
  bold, italic, fontName, fontSize, fontColorRgb, fillRgb, underline,
  headerBold, headerFillRgb, bordersOutline (bool — тонкая внешняя рамка).
  НЕ поддерживаются: толщина границ, внутренние линии, borderAll, merge,
  числовой формат, автофильтр. Клиенту — короткий итог без рассуждений;
  без фразы про XLSX/Лист после оформления. При неподдерживаемом — один отказ.
runtime: python@3
scriptFile: cell_format.py
schemas:
  input:
    type: object
    additionalProperties: false
    required:
      - format
    properties:
      target:
        type: string
      range:
        type: string
      cells:
        type: array
        items:
          type: string
      format:
        type: object
        additionalProperties: true
  output:
    type: object
    additionalProperties: true
    required:
      - ok
resources:
  cpu: 0.2
  memory: 64
  timeout: 30
  network:
    hosts: []
---

Оформление used / selection / range / cells в открытом Cell.
Только whitelist format-полей; неизвестные ключи → rejectedKeys / ok:false.
