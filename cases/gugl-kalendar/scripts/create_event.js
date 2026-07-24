async function handler(state, params) {
  const summary = params?.summary;
  const startDateTime = params?.startDateTime;
  const endDateTime = params?.endDateTime;
  const durationMinutes = params?.durationMinutes;
  const timeZone = params?.timeZone;
  const rawAttendees = Array.isArray(params?.attendees) ? params.attendees : [];
  const rawRecurrence = Array.isArray(params?.recurrence) ? params.recurrence : [];

  if (!summary || typeof summary !== "string") {
    return { ok: false, error: "INVALID_INPUT", details: { field: "summary" } };
  }
  if (!startDateTime || typeof startDateTime !== "string") {
    return { ok: false, error: "INVALID_INPUT", details: { field: "startDateTime" } };
  }

  const slot = buildGoogleCalendarStartEnd(
    startDateTime,
    endDateTime,
    durationMinutes,
    timeZone,
  );
  if (!slot.ok) {
    return slot;
  }

  const startMs = slot.startMs;
  const endMs = slot.endMs;
  const slotStart = slot.freeBusyMin;
  const slotEnd = slot.freeBusyMax;

  const warnings = [];
  const attendees = [];
  for (const raw of rawAttendees) {
    if (typeof raw !== "string") {
      continue;
    }
    const t = raw.trim();
    if (!t) {
      continue;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(t)) {
      warnings.push({ code: "INVALID_ATTENDEE_EMAIL_SKIPPED" });
      continue;
    }
    attendees.push(t);
  }

  const auth = await getValidAccessToken(state);
  if (!auth.ok) {
    return { ok: false, error: auth.error ?? "AUTH_REQUIRED" };
  }

  const token = auth.accessToken;

  const items = [{ id: "primary" }];
  const seen = new Set(["primary"]);
  for (const email of attendees) {
    const key = email.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    items.push({ id: email });
  }

  const conflicts = [];

  const fbRes = await fetch("https://www.googleapis.com/calendar/v3/freeBusy", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      timeMin: slotStart,
      timeMax: slotEnd,
      items,
    }),
  });

  if (!fbRes.ok) {
    warnings.push({
      code: "FREEBUSY_HTTP_ERROR",
      status: fbRes.status,
      message:
        "FreeBusy request failed; event will still be created; conflict list may be incomplete.",
    });
  } else {
    const fb = await fbRes.json();
    const calendars =
      fb.calendars && typeof fb.calendars === "object" ? fb.calendars : {};
    for (const item of items) {
      const id = item.id;
      const cal = calendars[id];
      if (!cal) {
        warnings.push({
          code: "FREEBUSY_NO_CALENDAR_ENTRY",
          calendarId: id,
        });
        continue;
      }
      if (Array.isArray(cal.errors) && cal.errors.length > 0) {
        warnings.push({
          code: "FREEBUSY_CALENDAR_ERRORS",
          calendarId: id,
          errors: cal.errors.map((e) => ({
            reason: e.reason ?? null,
            domain: e.domain ?? null,
          })),
        });
        continue;
      }
      const busyList = Array.isArray(cal.busy) ? cal.busy : [];
      const overlapping = [];
      for (const b of busyList) {
        if (!b?.start || !b?.end) {
          continue;
        }
        const bs = Date.parse(b.start);
        const be = Date.parse(b.end);
        if (!Number.isFinite(bs) || !Number.isFinite(be)) {
          continue;
        }
        if (intervalsOverlap(startMs, endMs, bs, be)) {
          overlapping.push({ start: b.start, end: b.end });
        }
      }
      if (overlapping.length > 0) {
        conflicts.push({
          calendarId: id,
          busyIntervals: overlapping,
        });
      }
    }
  }

  if (conflicts.length > 0) {
    warnings.push({
      code: "SCHEDULING_CONFLICTS_DETECTED",
      message:
        "Busy intervals overlap the proposed slot for one or more calendars; event is still created.",
    });
  }

  const eventBody = {
    summary,
    start: slot.start,
    end: slot.end,
  };
  if (attendees.length > 0) {
    eventBody.attendees = attendees.map((email) => ({ email }));
  }

  const recurrence = [];
  for (const raw of rawRecurrence) {
    if (typeof raw === "string" && raw.trim()) {
      recurrence.push(raw.trim());
    }
  }
  if (recurrence.length > 0) {
    eventBody.recurrence = recurrence;
  }

  const createRes = await fetch(
    "https://www.googleapis.com/calendar/v3/calendars/primary/events",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(eventBody),
    },
  );

  if (createRes.status === 401) {
    return { ok: false, error: "AUTH_REQUIRED" };
  }

  if (!createRes.ok) {
    const apiError = await readCalendarApiError(createRes);
    return {
      ok: false,
      error: `CALENDAR_API_${createRes.status}`,
      details: apiError,
    };
  }

  const createdEvent = await createRes.json();

  return {
    ok: true,
    createdEvent: summarizeCreated(createdEvent),
    conflicts,
    warnings,
  };
}

function intervalsOverlap(a0, a1, b0, b1) {
  return a0 < b1 && b0 < a1;
}

function summarizeCreated(ev) {
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