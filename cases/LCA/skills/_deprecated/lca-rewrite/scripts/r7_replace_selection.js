async function handler(state, params) {
  const p = params && typeof params === "object" ? params : {};
  let data = null;
  if (typeof params === "string" && params.trim()) {
    data = params;
  } else if (typeof p.text === "string" && p.text.trim()) {
    data = p.text;
  } else if (typeof p.html === "string" && p.html.trim()) {
    data = p.html;
  } else if (typeof p.data === "string" && p.data.trim()) {
    data = p.data;
  } else if (p.data && typeof p.data === "object" && typeof p.data.text === "string") {
    data = p.data.text;
  } else if (p.data && typeof p.data === "object" && typeof p.data.data === "string") {
    data = p.data.data;
  } else if (p.data && typeof p.data === "object" && typeof p.data.html === "string") {
    data = p.data.html;
  }
  if (data == null || data === "") {
    return { ok: false, error: "text/html/data обязателен" };
  }
  // Always flat string in `data` — nested { data: "…" } caused empty paste after delete.
  return {
    ok: true,
    type: "replace_selection",
    data: String(data)
  };
}
