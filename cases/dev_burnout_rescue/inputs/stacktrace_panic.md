# SOS, что это вообще

прилетело из мониторинга в 2 ночи, я ничего не понимаю:

```
Traceback (most recent call last):
  File "app/services/payments.py", line 142, in charge
    amount = order.total * rate
TypeError: unsupported operand type(s) for *: 'NoneType' and 'float'
  File "app/services/payments.py", line 98, in process
    result = charge(order, fx_rate())
```

`order.total` иногда None, но почему — без понятия. это в том самом легаси биллинге.
воспроизвести локально не могу, на проде падает раз в час примерно.

я не спал, я не знаю с чего начать, и мне страшно что я что-то сломаю ещё сильнее если полезу туда.
