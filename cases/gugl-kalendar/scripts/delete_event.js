async function handler(state, params) {
  const eventId = params?.eventId;

  if (!eventId || typeof eventId !== "string") {
    return { ok: false, error: "INVALID_INPUT", details: { field: "eventId" } };
  }

  const auth = await getValidAccessToken(state);
  if (!auth.ok) {
    return { ok: false, error: auth.error ?? "AUTH_REQUIRED" };
  }

  const token = auth.accessToken;
  const url =
    "https://www.googleapis.com/calendar/v3/calendars/primary/events/" +
    encodeURIComponent(eventId);

  const res = await fetch(url, {
    method: "DELETE",
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  if (res.status === 401) {
    return { ok: false, error: "AUTH_REQUIRED" };
  }
  if (res.status === 404 || res.status === 410) {
    return {
      ok: true,
      deleted: false,
      warning: "EVENT_ALREADY_DELETED_OR_NOT_FOUND",
      details: { eventId, status: res.status },
    };
  }
  if (!res.ok) {
    return { ok: false, error: `CALENDAR_API_${res.status}` };
  }

  return { ok: true, deleted: true, eventId };
}

async function getValidAccessToken(state) {
  const kv = state?.capabilities?.["key-value-storage"];
  if (!kv) {
    return { ok: false, error: "KEY_VALUE_STORAGE_UNAVAILABLE" };
  }

  const access = await kv.get("google_calendar_oauth_access_token");
  const refresh = await kv.get("google_calendar_oauth_refresh_token");
  const expRaw = await kv.get("google_calendar_oauth_token_expiry_ts");
  const exp = expRaw ? Number(expRaw) : 0;
  const now = Math.floor(Date.now() / 1000);
  const skew = 60;

  if (
    access &&
    typeof access === "string" &&
    (!Number.isFinite(exp) || exp <= 0 || now < exp - skew)
  ) {
    return { ok: true, accessToken: access };
  }

  if (!refresh || typeof refresh !== "string") {
    return { ok: false, error: "AUTH_REQUIRED" };
  }

  const clientId = state?.environment?.app?.GOOGLE_OAUTH_CLIENT_ID;
  const clientSecret = state?.environment?.app?.GOOGLE_OAUTH_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    return { ok: false, error: "MISSING_APP_CREDENTIALS" };
  }

  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refresh,
      client_id: clientId,
      client_secret: clientSecret,
    }),
  });

  if (!tokenRes.ok) {
    return { ok: false, error: "AUTH_REQUIRED" };
  }

  const tokens = await tokenRes.json();
  const newAccess = tokens.access_token;
  if (typeof newAccess !== "string" || !newAccess) {
    return { ok: false, error: "AUTH_REQUIRED" };
  }

  await kv.set("google_calendar_oauth_access_token", newAccess);
  const expiresIn = Number(tokens.expires_in);
  if (Number.isFinite(expiresIn) && expiresIn > 0) {
    await kv.set(
      "google_calendar_oauth_token_expiry_ts",
      String(Math.floor(Date.now() / 1000) + expiresIn),
    );
  }

  return { ok: true, accessToken: newAccess };
}