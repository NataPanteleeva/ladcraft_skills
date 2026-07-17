---
name: lca-cell
description: "Предпросмотр ячеек + r7.proposal cell_map; запись делает плагин после «да»; hint lca-cell."
mcp_spec:
  tools:
    - name: r7_cell_paste
version: 1.3.0
---

Заполни ячейки Cell.

## Шаг A
Покажи таблицу/список адрес → значение. **Без** `r7_cell_paste`.
В конце proposal (≤200 адресов):

```r7.proposal
{"schema":"r7.proposal/v1","kind":"cell_map","data":{"A1":"…","B2":42}}
```

Спроси: «Записать эти значения в таблицу? („да“ / „вставь“ / „одобряю“)».

## Шаг B
Плагин применит cell_map сам. Ты: краткий ack. **Не** вызывай tool, кроме сбоя / отсутствия proposal.
