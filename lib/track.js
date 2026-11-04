"use strict";

// POST /api/track: behavior events from track() in views/layout.hbs, forwarded to
// PiTrack like handleTrack in sociedad-web-front/lib/api.js and trackPage in
// gobernantes-web-front/lib/views.js. The browser only talks to this site, so the
// event no longer goes out to https://sociedad.info/track and back through the CDN.
// PITRACK_URL points at PiTrack on the same server (http://127.0.0.1:8102), which
// checks the forwarded Origin against its PITRACK_ALLOWED_ORIGINS.
// Bots and crawlers never get here: rateLimitMiddleware in app.js answers 403 to
// every POST from them. Fire-and-forget, so a slow PiTrack never holds the response.

const TRACK_MAX_BODY = 3000; // same cap PiTrack applies
const TRACK_SOURCE_ID = "qqw-poppins";
const PITRACK_TIMEOUT_MS = 5000;

function pitrackUrl() {
  return (process.env.PITRACK_URL || "").replace(/\/+$/, "");
}

// siteHosts: hosts this app serves, the Origin must be one of them (same check as lib/aviso.js).
function handler(siteHosts) {
  const origins = siteHosts.map((h) => "https://" + h);
  return function trackHandler(req, res) {
    const origin = req.headers.origin;
    if (!origin || !(origins.includes(origin) || (process.env.NODE_ENV !== "production" && /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)))) {
      return res.status(403).json({ success: false });
    }
    const event = req.body;
    if (!event || typeof event !== "object" || Array.isArray(event) || typeof event.event !== "string") {
      return res.status(400).json({ success: false, error: "Invalid event" });
    }
    event.sourceid = TRACK_SOURCE_ID;
    const body = JSON.stringify(event);
    if (Buffer.byteLength(body, "utf8") > TRACK_MAX_BODY) {
      return res.status(413).json({ success: false });
    }
    const url = pitrackUrl();
    if (!url) {
      return res.json({ success: false, reason: "tracking_disabled" });
    }
    fetch(url + "/track", {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: origin },
      body: body,
      signal: AbortSignal.timeout(PITRACK_TIMEOUT_MS),
    })
      .then((response) => {
        if (!response.ok) console.error(new Date(), "track: PiTrack respondio", response.status);
      })
      .catch((e) => console.error(new Date(), "track: PiTrack fallo", e.message));
    res.json({ success: true });
  };
}

module.exports = { handler };
