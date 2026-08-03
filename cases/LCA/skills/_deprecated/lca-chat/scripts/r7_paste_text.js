async function handler(state, params) {
  const p = params && typeof params === "object" ? params : {};
  let text = "";
  if (typeof params === "string") text = params;
  else if (typeof p.text === "string") text = p.text;
  else if (typeof p.data === "string") text = p.data;
  text = String(text);
  if (!text) return { ok: false, error: "text обязателен" };
  return { ok: true, type: "paste_text", data: text };
}
