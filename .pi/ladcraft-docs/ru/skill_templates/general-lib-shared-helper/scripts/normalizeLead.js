async function handler(state, params) {
  const name = normalizeLeadName(params && params.name);
  const email = normalizeEmail(params && params.email);
  return {
    ok: true,
    lead: {
      name,
      email
    },
    summary: formatLeadSummary({ name, email })
  };
}
