async function handler(state, params) {
  void params;

  const http = await import("node:http");

  const capabilities = state?.capabilities ?? {};
  const kvSet = capabilities["key-value-storage"]?.set;
  if (!kvSet) {
    return { ok: false, error: "KEY_VALUE_STORAGE_UNAVAILABLE" };
  }

  const clientId = String(state?.environment?.app?.GOOGLE_OAUTH_CLIENT_ID ?? "");
  const clientSecret = String(state?.environment?.app?.GOOGLE_OAUTH_CLIENT_SECRET ?? "");
  if (!clientId || !clientSecret) {
    return {
      ok: false,
      error: "MISSING_APP_CREDENTIALS",
      details: { need: ["GOOGLE_OAUTH_CLIENT_ID", "GOOGLE_OAUTH_CLIENT_SECRET"] },
    };
  }

  const callbackUrl = String(state.appHost);
  const scope =
    "https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/calendar.events.freebusy";

  const authUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  authUrl.searchParams.set("client_id", clientId);
  authUrl.searchParams.set("redirect_uri", callbackUrl);
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("scope", scope);
  authUrl.searchParams.set("access_type", "offline");
  authUrl.searchParams.set("prompt", "consent");

  state.socket.redirect({ url: authUrl.toString() });

  return await new Promise(async (resolve, reject) => {
    state.socket.removeAllListeners("data");

    const server = http.createServer();

    server.on("request", async (req, res) => {
      try {
        const { searchParams } = new URL(req.url, state.appHost);
        const code = String(searchParams.get("code") ?? "");
        const oauthError = String(searchParams.get("error") ?? "");

        if (oauthError) {
          res
            .writeHead(400, { "Content-Type": "text/html; charset=utf-8" })
            .end(`<html><body><p>OAuth error: ${escapeHtml(oauthError)}</p></body></html>`);
          reject(new Error(`GOOGLE_CALENDAR_OAUTH_ERROR_${oauthError}`));
          return;
        }

        if (!code) {
          res.writeHead(400).end("Missing code");
          reject(new Error("OAUTH_MISSING_CODE"));
          return;
        }

        const tokenBody = {
          grant_type: "authorization_code",
          code,
          client_id: clientId,
          client_secret: clientSecret,
          redirect_uri: callbackUrl,
        };

        const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams(tokenBody),
        });

        if (!tokenRes.ok) {
          res.writeHead(502).end("Token exchange failed");
          reject(new Error(`TOKEN_EXCHANGE_${tokenRes.status}`));
          return;
        }

        const tokens = await tokenRes.json();
        const accessToken = typeof tokens.access_token === "string" ? tokens.access_token : "";
        const refreshToken = typeof tokens.refresh_token === "string" ? tokens.refresh_token : "";

        if (!accessToken) {
          res.writeHead(502).end("Invalid token response");
          reject(new Error("TOKEN_RESPONSE_INVALID"));
          return;
        }

        await kvSet("google_calendar_oauth_access_token", accessToken);
        if (refreshToken) {
          await kvSet("google_calendar_oauth_refresh_token", refreshToken);
        }
        const expiresIn = Number(tokens.expires_in);
        if (Number.isFinite(expiresIn) && expiresIn > 0) {
          const expTs = Math.floor(Date.now() / 1000) + expiresIn;
          await kvSet("google_calendar_oauth_token_expiry_ts", String(expTs));
        }

        res
          .writeHead(200, { "Content-Type": "text/html; charset=utf-8" })
          .end(
            "<html><body><h1>Авторизация успешна. Можно закрыть вкладку.</h1></body></html>",
          );

        resolve({
          ok: true,
          status: "authorized",
          message:
            "Токены сохранены в хранилище навыка. Можно вызывать list_events, create_event, update_event и delete_event.",
          refresh_token_saved: Boolean(refreshToken),
        });
      } catch (err) {
        res.writeHead(500).end("Internal error");
        reject(err);
      }
    });

    server.emit("connection", state.socket);
  });
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}