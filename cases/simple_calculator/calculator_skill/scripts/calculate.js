async function handler(state, params) {
  const a = getNumber(params, 'a');
  const b = getNumber(params, 'b');
  const operation = getString(params, 'operation').trim();

  if (!Number.isFinite(a)) {
    return { ok: false, error: 'a должно быть конечным числом' };
  }
  if (!Number.isFinite(b)) {
    return { ok: false, error: 'b должно быть конечным числом' };
  }

  const ops = {
    add: function (x, y) { return x + y; },
    subtract: function (x, y) { return x - y; },
    multiply: function (x, y) { return x * y; },
    divide: function (x, y) {
      if (y === 0) return null;
      return x / y;
    }
  };

  const fn = ops[operation];
  if (!fn) {
    return { ok: false, error: 'operation должна быть add | subtract | multiply | divide' };
  }

  const result = fn(a, b);
  if (result === null) {
    return { ok: false, error: 'деление на ноль' };
  }

  return { ok: true, a: a, b: b, operation: operation, result: result };
}
