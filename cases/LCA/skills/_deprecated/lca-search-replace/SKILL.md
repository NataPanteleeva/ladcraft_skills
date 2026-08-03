---
name: lca-search-replace
description: Fallback поиска/замены (X→Y или нет proposal); «исправь все/N» обычно делает плагин по r7.proposal; hint lca-search-replace.
mcp_spec:
  tools:
    - name: r7_search_replace
version: 1.3.0
---

## Primary

Если в предыдущем ответе уже был ```r7.proposal``` `kind=findings`, плагин **сам** применил замены на «исправь все» / «исправь N».

Ты: **одна** фраза ack («Готово, правки применены» / «Внёс замены по пунктам …»). **Не** вызывай `r7_search_replace`. **Не** рисуй таблицу снова.

## Когда всё же нужен tool

Только если:

- пользователь сказал **«замени X на Y»** без списка/proposal;
- или proposal отсутствует / битый, а согласие на правки уже есть.

Тогда вызови `r7_search_replace` (`search`, `replace`, `matchCase` опц.), до 15 вызовов.

## Оформление

SearchAndReplace — plain text. Для HTML-переписи → `lca-rewrite`.

## r7.event

После `apply_result`: не re-apply; не дублируй список. Сырой JSON не показывай.
