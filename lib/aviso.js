"use strict";

// Yellow banner ("Avísame cuando se vuelvan a actualizar los datos", partials/pitrack-banner.hbs).
// Each step is mailed to the team inbox, ops@sociedad.info by default. Same flow
// as gobernantes-web-front/lib/contact.js: Brevo's transactional API over fetch,
// plain text only so nothing the person types is rendered as HTML, replyTo set
// to the person. PiTrack keeps getting its own events from the browser.

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
  const message = { step, email, page: oneLine(body.page, 500) };
  if (step === "survey") {
    const services = Array.isArray(body.services) ? body.services : [];
    message.services = services.filter((s) => Object.prototype.hasOwnProperty.call(SERVICES, s)).map((s) => SERVICES[s]);
    message.willingToPay = { yes: "Sí", no: "No" }[body.willing_to_pay] || "Sin respuesta";
    message.comments = String(body.comments || "").trim().substring(0, 2000);
  }
  return message;
}

function buildText(message, meta) {
  const lines = [
    "Email: " + message.email,
    "Página: " + (message.page || "-"),
    "Sitio: " + (meta.site || "-"),
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

async function send(message, meta) {
  const { apiKey, to, from } = config();
  if (!apiKey) throw new Error("Brevo no configurado (falta BREVO_API_KEY)");
  const subject = message.step === "survey"
    ? "[QQW] Encuesta de la barra: " + message.email
    : "[QQW] Aviso de actualización: " + message.email;
  const response = await fetch(BREVO_EMAIL_URL, {
    method: "POST",
    headers: { "api-key": apiKey, "accept": "application/json", "content-type": "application/json" },
    body: JSON.stringify({
      sender: { name: "QuienEsQuien.Wiki", email: from },
      to: [{ email: to }],
      replyTo: { email: message.email },
      subject: subject,
      textContent: buildText(message, meta),
    }),
    signal: AbortSignal.timeout(BREVO_TIMEOUT_MS),
  });
  if (response.status !== 201 && response.status !== 200) {
    const detail = await response.text().catch(() => "");
    throw new Error("Brevo respondió " + response.status + ": " + detail.substring(0, 300));
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
