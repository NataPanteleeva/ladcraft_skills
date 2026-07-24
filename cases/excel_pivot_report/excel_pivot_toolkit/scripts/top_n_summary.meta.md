---
name: top_n_summary
description: >-
  Топ-N категорий по мере + лист KPI; пишет targetPath (листы Топ и KPI).
runtime: python@3
scriptFile: top_n_summary.py
schemas:
  input:
    type: object
    additionalProperties: false
    required:
      - sourcePath
      - categoryField
      - valueField
    properties:
      sourcePath:
        type: string
      sourceSheet:
        type: string
      targetPath:
        type: string
      categoryField:
        type: string
      valueField:
        type: string
      aggregation:
        type: string
      topN:
        type: number
      includeOther:
        type: boolean
  output:
    type: object
    additionalProperties: true
    required:
      - ok
resources:
  cpu: 0.5
  memory: 256
  timeout: 120
  network:
    hosts: []
---

Топ-N и KPI.
