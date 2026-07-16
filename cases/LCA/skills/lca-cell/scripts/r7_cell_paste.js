async function handler(state, params) {
  const p = params && typeof params === "object" ? params : {};
  let data = p.data && typeof p.data === "object" && !Array.isArray(p.data) ? p.data : null;
  if (!data) {
    const copy = {};
    const keys = Object.keys(p);
    for (let i = 0; i < keys.length; i++) {
      const k = keys[i];
      if (k === "ok" || k === "type") continue;
      if (/^[A-Za-z]+[0-9]+$/.test(k)) copy[k] = p[k];
    }
    if (Object.keys(copy).length) data = copy;
  }
  if (!data || !Object.keys(data).length) {
    return { ok: false, error: "нужна карта ячеек A1.." };
  }
  if (Object.keys(data).length > 200) {
    return { ok: false, error: "не более 200 ячеек за вызов" };
  }
  return { ok: true, type: "cell_paste", data: data };
}
