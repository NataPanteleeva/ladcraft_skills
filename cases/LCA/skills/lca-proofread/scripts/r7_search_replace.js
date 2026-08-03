async function handler(state, params) {
  const p = params && typeof params === "object" ? params : {};
  const search = typeof p.search === "string" ? p.search : "";
  const replace =
    typeof p.replace === "string"
      ? p.replace
      : p.replace === undefined
        ? null
        : String(p.replace);
  if (!search || replace === null) {
    return { ok: false, error: "search и replace обязательны" };
  }
  const matchCase = typeof p.matchCase === "boolean" ? p.matchCase : false;
  return {
    ok: true,
    type: "search_replace",
    search: search,
    replace: replace,
    matchCase: matchCase,
    data: { search: search, replace: replace, matchCase: matchCase }
  };
}
