"use strict";

// Yellow banner ("Avísame cuando se vuelvan a actualizar los datos", partials/pitrack-banner.hbs).
// Each step is mailed to the team inbox, ops@sociedad.info by default. Same flow
// as gobernantes-web-front/lib/contact.js: Brevo's transactional API over fetch,
// plain text only so nothing the person types is rendered as HTML. PiTrack keeps
// getting its own events from the browser.
// The team copy goes without Reply-To: Mayfirst's SpamAssassin gave 2.7 points to a
// freemail Reply-To with a From in sociedad.info (FREEMAIL_FORGED_REPLYTO and
// FREEMAIL_REPLYTO_END_DIGIT) and real signups landed in Spam (6.4 of 5.0, 2026-10-21).
// The Conversations copy keeps it, so the ticket is opened for the person.
// A copy goes to Brevo Conversations the way sociedad's and gobernantes' contact
// forms do: by email to the Brevo inbound address of the Conversations inbox
// (AVISO_CONVERSATIONS), there is no API to post a visitor message. The sender
// is never that inbound address, so answering a ticket can't feed it back into
// the queue (sociedad-web-front/docs/2026-09-10-bug-loop-correo-y-duplicacion-tickets.md).

const BREVO_EMAIL_URL = "https://api.brevo.com/v3/smtp/email";
const BREVO_TIMEOUT_MS = 8000;

// Per IP and global caps. The global one protects the inbox from a flood that
// rotates IPs. In memory, so per pm2 instance: the real cap is this times the
// number of instances.
const PER_IP_MAX = 4;
const PER_IP_WINDOW_MS = 60 * 60 * 1000;
const GLOBAL_MAX = 60;
const GLOBAL_WINDOW_MS = 60 * 60 * 1000;

const SERVICES = {
  compliance: "Informes para compliance",
  market_research: "Investigación de mercado",
  public_procurement: "Inteligencia del mercado de compras públicas",
  ads_sponsorship: "Anunciar/patrocinar perfiles de empresas",
  data_api: "Acceso a Datos/API",
  other: "Otros",
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function config() {
  return {
    apiKey: process.env.BREVO_API_KEY,
    to: process.env.AVISO_TO || "ops@sociedad.info",
    from: process.env.AVISO_FROM || "noreply@sociedad.info",
    conversations: process.env.AVISO_CONVERSATIONS || null,
  };
}

function isEnabled() {
  return Boolean(config().apiKey);
}

function oneLine(value, max) {
  return String(value || "").replace(/[\r\n\t]+/g, " ").trim().substring(0, max || 200);
}

// Returns { step, email, page, services, willingToPay, comments } or null if invalid.
function parse(body) {
  if (!body || typeof body !== "object") return null;
  const email = oneLine(body.email, 254);
  if (!EMAIL_RE.test(email)) return null;
  const step = body.step === "survey" ? "survey" : "email";
  const historyLength = parseInt(body.history_length, 10);
  const message = {
    step,
    email,
    page: oneLine(body.page, 500),
    referrer: oneLine(body.referrer, 500),
    historyLength: historyLength >= 1 && historyLength <= 100 ? historyLength : null,
  };
  if (step === "survey") {
    const services = Array.isArray(body.services) ? body.services : [];
    message.services = services.filter((s) => Object.prototype.hasOwnProperty.call(SERVICES, s)).map((s) => SERVICES[s]);
    message.willingToPay = { yes: "Sí", no: "No" }[body.willing_to_pay] || "Sin respuesta";
    message.comments = String(body.comments || "").trim().substring(0, 2000);
  }
  return message;
}

// Path and query only: the host is already in "Sitio", and a full URL with a query
// on a .info host that isn't www is one more SpamAssassin point (URI_NO_WWW_INFO_CGI).
function pagePath(page) {
  try {
    const u = new URL(page);
    return u.pathname + u.search;
  } catch (e) {
    return page;
  }
}

// Previous page from document.referrer: a path when it is the same site, the host
// when the person came from somewhere else (Instagram, Google). Never a full URL
// with its query, for the same SpamAssassin rule as the page.
function previousPage(message) {
  if (!message.referrer) return "Llegó directo o el navegador no informó la página anterior";
  try {
    const ref = new URL(message.referrer);
    let pageHost = null;
    try { pageHost = new URL(message.page).host; } catch (e) {}
    if (pageHost && ref.host === pageHost) return "Página anterior: " + ref.pathname + ref.search;
    return "Llegó desde: " + ref.host;
  } catch (e) {
    return "Página anterior: -";
  }
}

function buildText(message, meta) {
  const lines = [
    "Email: " + message.email,
    "Página: " + (message.page ? pagePath(message.page) : "-"),
    "Sitio: " + (meta.site || "-"),
    previousPage(message),
    "Páginas en la pestaña: " + (message.historyLength || "-") + " (incluye las de otros sitios)",
  ];
  if (message.step === "survey") {
    lines.push(
      "",
      "Servicios: " + (message.services.length ? message.services.join(", ") : "-"),
      "Pagaría: " + message.willingToPay,
      "",
      "Comentarios:",
      message.comments || "-"
    );
  }
  lines.push(
    "",
    "---",
    "IP: " + (meta.ip || "-"),
    "País: " + (meta.country || "-"),
    "User-Agent: " + (meta.userAgent || "-")
  );
  return lines.join("\n");
}

const hits = new Map();
let globalHits = [];

function allowed(ip, now) {
  globalHits = globalHits.filter((t) => now - t < GLOBAL_WINDOW_MS);
  if (globalHits.length >= GLOBAL_MAX) return false;
  const recent = (hits.get(ip) || []).filter((t) => now - t < PER_IP_WINDOW_MS);
  if (recent.length >= PER_IP_MAX) {
    hits.set(ip, recent);
    return false;
  }
  recent.push(now);
  hits.set(ip, recent);
  globalHits.push(now);
  if (hits.size > 10000) hits.clear();
  return true;
}

async function sendOne(apiKey, payload) {
  const response = await fetch(BREVO_EMAIL_URL, {
    method: "POST",
    headers: { "api-key": apiKey, "accept": "application/json", "content-type": "application/json" },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(BREVO_TIMEOUT_MS),
  });
  if (response.status !== 201 && response.status !== 200) {
    const detail = await response.text().catch(() => "");
    throw new Error("Brevo respondió " + response.status + ": " + detail.substring(0, 300));
  }
}

// Throws if the team email fails. The Conversations copy is best effort.
async function send(message, meta) {
  const { apiKey, to, from, conversations } = config();
  if (!apiKey) throw new Error("Brevo no configurado (falta BREVO_API_KEY)");
  if (conversations && conversations === from) {
    throw new Error("AVISO_CONVERSATIONS no puede ser el remitente (loop de tickets)");
  }
  // Same subject for both steps of a person, so the survey reads as a follow-up
  const payload = {
    sender: { name: "QuienEsQuien.Wiki", email: from },
    subject: "[QQW] Aviso de actualización: " + message.email,
    textContent: (message.step === "survey" ? "Encuesta de la barra amarilla\n\n" : "Pidió aviso en la barra amarilla\n\n") + buildText(message, meta),
  };
  await sendOne(apiKey, { ...payload, to: [{ email: to }] });
  if (conversations) {
    try {
      await sendOne(apiKey, { ...payload, replyTo: { email: message.email }, to: [{ email: conversations }] });
    } catch (e) {
      console.error(new Date(), "aviso: fallo la copia a Conversations", message.step, e.message);
    }
  }
}

// POST /api/aviso. siteHosts: hosts this app serves, the Origin must be one of them.
function handler(siteHosts) {
  const origins = siteHosts.map((h) => "https://" + h);
  return async function avisoHandler(req, res) {
    const origin = req.headers.origin;
    if (!origin || !(origins.includes(origin) || (process.env.NODE_ENV !== "production" && /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)))) {
      return res.status(403).json({ ok: false });
    }
    const message = parse(req.body);
    if (!message) return res.status(400).json({ ok: false });
    if (!isEnabled()) return res.status(503).json({ ok: false });

    const ip = req.headers["x-real-ip"] || req.socket.remoteAddress || "";
    if (!allowed(ip, Date.now())) return res.status(429).json({ ok: false });

    const meta = {
      ip: ip,
      country: req.headers["x-country-code"] || "",
      userAgent: oneLine(req.headers["user-agent"], 300),
      site: origin.replace(/^https?:\/\//, ""),
    };
    try {
      await send(message, meta);
      console.log(new Date(), "aviso: enviado", message.step, meta.site);
      res.json({ ok: true });
    } catch (e) {
      console.error(new Date(), "aviso: fallo el envio", message.step, e.message);
      res.status(502).json({ ok: false });
    }
  };
}

module.exports = { handler, parse, buildText, isEnabled };
