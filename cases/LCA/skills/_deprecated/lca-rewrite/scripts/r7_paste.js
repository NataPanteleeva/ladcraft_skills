async function handler(state, params) {
  const p = params && typeof params === "object" ? params : {};
  let html = "";
  if (typeof params === "string") html = params;
  else if (typeof p.html === "string") html = p.html;
  else if (typeof p.data === "string") html = p.data;
  else if (typeof p.text === "string") html = p.text;
  html = html.trim();
  if (!html) {
    return { ok: false, error: "html/data обязателен" };
  }
  return {
    ok: true,
    type: "paste",
    data: html
  };
}
