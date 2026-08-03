async function handler(state, params) {
  const p = params && typeof params === "object" ? params : {};
  let html = "";
  if (typeof params === "string") html = params;
  else if (typeof p.html === "string") html = p.html;
  else if (typeof p.data === "string") html = p.data;
  else if (typeof p.text === "string") html = p.text;
  html = String(html).trim();
  if (!html) return { ok: false, error: "html обязателен" };
  return { ok: true, type: "paste", data: html };
}
