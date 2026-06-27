async function handler(state, params) {
  const summary = formatLeadSummary({
    name: params && params.name,
    email: params && params.email
  });
  return {
    ok: true,
    summary
  };
}
