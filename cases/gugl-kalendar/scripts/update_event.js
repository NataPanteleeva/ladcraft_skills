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
  const body = {};

  if (params?.summary !== undefined) {
    if (typeof params.summary !== "string") {
      return { ok: false, error: "INVALID_INPUT", details: { field: "summary" } };
    }
    body.summary = params.summary;
  }

  if (params?.startDateTime !== undefined) {
    const built = buildGoogleCalendarStartEnd(
      params.startDateTime,
      params.endDateTime,
      params.durationMinutes,
      params.timeZone,
    );
    if (!built.ok) {
      return built;
    }
    body.start = built.start;
    if (params.endDateTime !== undefined || params.durationMinutes != null) {
      body.end = built.end;
    }
  } else if (params?.endDateTime !== undefined) {
    const endMs = Date.parse(params.endDateTime);
    if (!Number.isFinite(endMs)) {
      return { ok: false, error: "INVALID_INPUT", details: { field: "endDateTime" } };
    }
    const endOffsetMatch = params.endDateTime.match(/([+-]\d{2}:\d{2})$/);
    const timeZone =
      (typeof params.timeZone === "string" && params.timeZone.trim()) ||
      (endOffsetMatch && offsetToIana(endOffsetMatch[1])) ||
      "UTC";
    const endWall = endOffsetMatch
      ? stripFraction(params.endDateTime.slice(0, -endOffsetMatch[0].length))
      : params.endDateTime;
    body.end = { dateTime: endWall, timeZone: timeZone };
  }

  if (Array.isArray(params?.attendees)) {
    const attendees = [];
    for (const raw of params.attendees) {
      if (typeof raw !== "string") continue;
      const t = raw.trim();
      if (!t) continue;
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(t)) continue;
      attendees.push({ email: t });
    }
    if (attendees.length > 0) {
      body.attendees = attendees;
    }
  }

  if (params?.location !== undefined) {
    if (typeof params.location !== "string") {
      return { ok: false, error: "INVALID_INPUT", details: { field: "location" } };
    }
    body.location = params.location;
  }

  if (params?.description !== undefined) {
    if (typeof params.description !== "string") {
      return { ok: false, error: "INVALID_INPUT", details: { field: "description" } };
    }
    body.description = params.description;
  }

  if (params?.recurrence !== undefined) {
    if (!Array.isArray(params.recurrence)) {
      return { ok: false, error: "INVALID_INPUT", details: { field: "recurrence" } };
    }
    const recurrence = [];
    for (const raw of params.recurrence) {
      if (typeof raw === "string" && raw.trim()) {
        recurrence.push(raw.trim());
      }
    }
    if (recurrence.length > 0) {
      body.recurrence = recurrence;
    }
  }

  const url =
    "https://www.googleapis.com/calendar/v3/calendars/primary/events/" +
    encodeURIComponent(eventId);

  const res = await fetch(url, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (res.status === 401) {
    return { ok: false, error: "AUTH_REQUIRED" };
  }
  if (res.status === 404) {
    return { ok: false, error: "NOT_FOUND", details: { eventId } };
  }
  if (!res.ok) {
    const apiError = await readCalendarApiError(res);
    return {
      ok: false,
      error: `CALENDAR_API_${res.status}`,
      details: apiError,
    };
  }

  const updated = await res.json();

  return {
    ok: true,
    updatedEvent: summarizeEvent(updated),
  };
}

function summarizeEvent(ev) {
  return {
    id: ev?.id ?? null,
    htmlLink: ev?.htmlLink ?? null,
    summary: ev?.summary ?? null,
    start: ev?.start ?? null,
    end: ev?.end ?? null,
    status: ev?.status ?? null,
  };
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