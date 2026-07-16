async function handler(state, params) {
  const p = params && typeof params === "object" ? params : {};
  let text = "";
  if (typeof p.text === "string") text = p.text.trim();
  else if (typeof p.comment === "string") text = p.comment.trim();
  else if (typeof params === "string") text = params.trim();
  if (!text) return { ok: false, error: "text обязателен" };
  return { ok: true, type: "add_comment", text: text, data: { text: text } };
}
