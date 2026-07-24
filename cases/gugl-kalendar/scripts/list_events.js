async function handler(state, params) {
  const preset = params?.preset;
  const days = params?.days;

  const range = presetToRange(preset, days);
  if (!range) {
    return {
      ok: false,
      error: "INVALID_PRESET",
      details: {
        preset,
        hint: "Use today, tomorrow, this_week, or next_n_days with days 1-30.",
      },
    };
  }

  const auth = await getValidAccessToken(state);
  if (!auth.ok) {
    return { ok: false, error: auth.error ?? "AUTH_REQUIRED" };
  }

  const url = new URL("https://www.googleapis.com/calendar/v3/calendars/primary/events");
  url.searchParams.set("timeMin", range.timeMin);
  url.searchParams.set("timeMax", range.timeMax);
  url.searchParams.set("singleEvents", "true");
  url.searchParams.set("orderBy", "startTime");
  url.searchParams.set("maxResults", "250");

  const res = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${auth.accessToken}` },
  });

  if (res.status === 401) {
    return { ok: false, error: "AUTH_REQUIRED" };
  }

  if (!res.ok) {
    return { ok: false, error: `CALENDAR_API_${res.status}` };
  }

  const data = await res.json();
  const items = Array.isArray(data.items) ? data.items : [];
  const events = items.map(normalizeEvent);

  return {
    ok: true,
    preset,
    timeMin: range.timeMin,
    timeMax: range.timeMax,
    count: events.length,
    events,
  };
}

function normalizeEvent(ev) {
  if (!ev || typeof ev !== "object") {
    return {};
  }
  const attendees = Array.isArray(ev.attendees)
    ? ev.attendees.map((a) => ({
        email: a.email ?? null,
        responseStatus: a.responseStatus ?? null,
      }))
    : [];

  let conferenceLink = null;
  if (typeof ev.hangoutLink === "string" && ev.hangoutLink) {
    conferenceLink = ev.hangoutLink;
  } else if (ev.conferenceData && typeof ev.conferenceData === "object") {
    const entryPoints = ev.conferenceData.entryPoints;
    if (Array.isArray(entryPoints)) {
      for (const ep of entryPoints) {
        if (
          ep &&
          typeof ep === "object" &&
          ep.entryPointType === "video" &&
          typeof ep.uri === "string" &&
          ep.uri
        ) {
          conferenceLink = ep.uri;
          break;
        }
      }
    }
  }

  return {
    id: ev.id ?? null,
    summary: ev.summary ?? null,
    description: typeof ev.description === "string" ? ev.description : null,
    status: ev.status ?? null,
    htmlLink: ev.htmlLink ?? null,
    start: ev.start ?? null,
    end: ev.end ?? null,
    recurrence: ev.recurrence ?? null,
    location: typeof ev.location === "string" ? ev.location : null,
    conferenceLink,
    attendees,
  };
}

function startOfLocalDay(d) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function presetToRange(preset, days) {
  const now = new Date();
  if (preset === "today") {
    const start = startOfLocalDay(now);
    const end = new Date(start);
    end.setDate(end.getDate() + 1);
    return { timeMin: start.toISOString(), timeMax: end.toISOString() };
  }
  if (preset === "tomorrow") {
    const start = startOfLocalDay(now);
    start.setDate(start.getDate() + 1);
    const end = new Date(start);
    end.setDate(end.getDate() + 1);
    return { timeMin: start.toISOString(), timeMax: end.toISOString() };
  }
  if (preset === "this_week") {
    const start = startOfLocalDay(now);
    const dow = start.getDay();
    const mondayOffset = dow === 0 ? -6 : 1 - dow;
    start.setDate(start.getDate() + mondayOffset);
    const end = new Date(start);
    end.setDate(end.getDate() + 7);
    return { timeMin: start.toISOString(), timeMax: end.toISOString() };
  }
  if (preset === "next_n_days") {
    const n = Number(days);
    if (!Number.isFinite(n) || n < 1 || n > 30) {
      return null;
    }
    const start = startOfLocalDay(now);
    const end = new Date(start);
    end.setDate(end.getDate() + n);
    return { timeMin: start.toISOString(), timeMax: end.toISOString() };
  }
  return null;
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