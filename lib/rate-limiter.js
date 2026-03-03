"use strict";

const fs = require("fs");
const path = require("path");

/**
 * Rate limiter for qqw-poppins (QuiénEsQuién.Wiki).
 * In-memory rate limiting: crawlers, bots, global, subnet. Blocks POST from bots/crawlers.
 * WARNING: Single-server only; use Redis for multi-server.
 */

const BLOCK_LOG_PATH = path.join(__dirname, "..", "logs", "rate-limit-blocks.log");
const BLOCKS_STATE_PATH = path.join(__dirname, "..", "logs", "rate-limit-state.json");
const MAX_ESCALATION_LEVEL = 6;
const ESCALATION_DECAY_MS = 6 * 60 * 60 * 1000;

const rateLimitStore = new Map();
const escalationStore = new Map();

const CRAWLER_UA_RE = /googlebot|bingbot|yandex|slurp|baiduspider|duckduckbot|mediapartners-google|adsbot-google|apis-google|applebot|google-read-aloud/i;
const BOT_UA_RE = /bot|semrush|ahref|bytespider|sogou|serpstat|dataforseo|oai-searchbot|headlesschrome|crawler|facebookexternalhit|hubspot|newsai/i;
const RENDERER_UA_RE = /Nexus 5X Build\/MMB29P/i;

const RATE_LIMITS = {
  crawler: { maxAttempts: 600, windowMs: 60 * 1000, blockDurationMs: 5 * 60 * 1000 },
  bot: { maxAttempts: 30, windowMs: 60 * 1000, blockDurationMs: 5 * 60 * 1000 },
  global: { maxAttempts: 1000, windowMs: 5 * 60 * 1000, blockDurationMs: 10 * 60 * 1000 },
  subnet24: { maxAttempts: 200, windowMs: 5 * 60 * 1000, blockDurationMs: 10 * 60 * 1000 },
  subnet16: { maxAttempts: 500, windowMs: 5 * 60 * 1000, blockDurationMs: 15 * 60 * 1000 },
};

function ensureLogsDir() {
  const logDir = path.dirname(BLOCK_LOG_PATH);
  if (!fs.existsSync(logDir)) {
    fs.mkdirSync(logDir, { recursive: true });
  }
}

function loadBlocksState() {
  try {
    if (!fs.existsSync(BLOCKS_STATE_PATH)) return;
    const raw = fs.readFileSync(BLOCKS_STATE_PATH, "utf8");
    const state = JSON.parse(raw);
    const now = Date.now();
    for (const entry of state.blocks || []) {
      if (entry.blockUntil > now) {
        rateLimitStore.set(entry.key, {
          count: entry.count,
          resetTime: entry.resetTime,
          blocked: true,
          blockUntil: entry.blockUntil,
          ua: entry.ua || "",
        });
        if (entry.escalation > 0) {
          escalationStore.set(entry.key, {
            level: entry.escalation,
            expiresAt: entry.escalationExpiresAt || entry.blockUntil + ESCALATION_DECAY_MS,
          });
        }
      }
    }
    for (const entry of state.escalations || []) {
      if (entry.expiresAt > now && !escalationStore.has(entry.key)) {
        escalationStore.set(entry.key, { level: entry.level, expiresAt: entry.expiresAt });
      }
    }
  } catch (e) {
    console.error("[RATE-LIMIT] Failed to load state:", e.message);
  }
}

function saveBlocksState() {
  try {
    ensureLogsDir();
    const now = Date.now();
    const blocks = [];
    for (const [key, data] of rateLimitStore.entries()) {
      if (data.blocked && data.blockUntil > now) {
        blocks.push({
          key,
          count: data.count,
          resetTime: data.resetTime,
          blockUntil: data.blockUntil,
          ua: data.ua || "",
          escalation: (escalationStore.get(key) || {}).level || 0,
          escalationExpiresAt: (escalationStore.get(key) || {}).expiresAt || 0,
        });
      }
    }
    const escalations = [];
    for (const [key, esc] of escalationStore.entries()) {
      if (esc.expiresAt > now) {
        escalations.push({ key, level: esc.level, expiresAt: esc.expiresAt });
      }
    }
    fs.writeFileSync(BLOCKS_STATE_PATH, JSON.stringify({ savedAt: new Date().toISOString(), blocks, escalations }, null, 2));
  } catch (e) {
    console.error("[RATE-LIMIT] Failed to save state:", e.message);
  }
}

loadBlocksState();

function logBlockExpired(storeKey, data) {
  const uaShort = summarizeUA(data.ua);
  const level = (escalationStore.get(storeKey) || {}).level || 0;
  const line = `[RATE-LIMIT] Block expired ${storeKey} | ua: ${uaShort}${level > 0 ? ` (L${level})` : ""}`;
  console.log(line);
  try {
    ensureLogsDir();
    fs.appendFileSync(BLOCK_LOG_PATH, new Date().toISOString() + "  " + line + "\n");
  } catch (e) {}
}

function getAgentType(req) {
  const ua = (req && req.headers && req.headers["user-agent"]) || "";
  const isPlaywrightInDev = process.env.NODE_ENV !== "production" && /playwright|headlesschrome|headless/i.test(ua);
  if (isPlaywrightInDev) return null;
  if (CRAWLER_UA_RE.test(ua)) return "crawler";
  if (BOT_UA_RE.test(ua)) return "bot";
  if (RENDERER_UA_RE.test(ua)) return "crawler";
  if (!ua || !req.headers["accept-language"]) return "bot";
  return null;
}

function getClientIP(req) {
  const realIP = req.headers["x-real-ip"];
  if (realIP) return realIP;
  const forwardedFor = req.headers["x-forwarded-for"];
  if (forwardedFor) {
    const ips = forwardedFor.split(",").map((ip) => ip.trim());
    return ips[ips.length - 1];
  }
  return req.socket?.remoteAddress || req.connection?.remoteAddress || "unknown";
}

function summarizeUA(ua) {
  if (!ua) return "";
  const botMatch = ua.match(/(googlebot|bingbot|yandexbot|semrushbot|ahrefsbot|headlesschrome|bot|crawler)[\/\s]?([^\s;)]*)?/i);
  if (botMatch) return botMatch[2] ? `${botMatch[1]}/${botMatch[2]}` : botMatch[1];
  const browserMatch = ua.match(/(Chrome|Firefox|Safari|Edge|Opera)[\/\s]?([\d.]+)?/);
  if (browserMatch) return `${browserMatch[1]}/${browserMatch[2] || "?"}`;
  return ua.length > 40 ? "…" + ua.slice(-40) : ua;
}

function getSubnet(ip, prefixBits) {
  const normalized = ip.startsWith("::ffff:") ? ip.slice(7) : ip;
  if (normalized.includes(":")) {
    const v6Bits = prefixBits <= 24 ? prefixBits * 2 : prefixBits;
    const take = Math.floor(v6Bits / 16);
    const groups = normalized.split(":");
    return groups.slice(0, Math.min(take, groups.length)).join(":") + "::/" + v6Bits;
  }
  const octets = normalized.split(".");
  const take = Math.floor(prefixBits / 8);
  return octets.slice(0, take).join(".") + ".x/" + prefixBits;
}

function checkRateLimit(key, limitType, ua) {
  const config = RATE_LIMITS[limitType];
  if (!config) return { allowed: true, remaining: 999, resetTime: null, retryAfter: 0 };

  const now = Date.now();
  const storeKey = `${limitType}:${key}`;
  let data = rateLimitStore.get(storeKey);

  if (!data || data.resetTime < now) {
    data = { count: 0, resetTime: now + config.windowMs, blocked: false, blockUntil: 0, ua: ua || "" };
  }
  if (ua) data.ua = ua;

  if (data.blocked && data.blockUntil > now) {
    return { allowed: false, remaining: 0, resetTime: new Date(data.blockUntil), retryAfter: Math.ceil((data.blockUntil - now) / 1000) };
  }
  if (data.blocked && data.blockUntil <= now) {
    logBlockExpired(storeKey, data);
    data.blocked = false;
    data.count = 0;
    data.resetTime = now + config.windowMs;
  }

  data.count++;
  if (data.count > config.maxAttempts) {
    const prevLevel = (escalationStore.get(storeKey) || {}).level || 0;
    const level = Math.min(prevLevel + 1, MAX_ESCALATION_LEVEL);
    const escalatedDuration = config.blockDurationMs * Math.pow(2, level - 1);
    data.blocked = true;
    data.blockUntil = now + escalatedDuration;
    escalationStore.set(storeKey, { level, expiresAt: data.blockUntil + ESCALATION_DECAY_MS });
    rateLimitStore.set(storeKey, data);
    const retryAfter = Math.ceil(escalatedDuration / 1000);
    console.log(`[RATE-LIMIT] Blocked ${storeKey} | ${config.maxAttempts} reqs/${config.windowMs / 1000}s → block ${retryAfter}s`);
    try {
      ensureLogsDir();
      fs.appendFileSync(BLOCK_LOG_PATH, new Date().toISOString() + "  Blocked " + storeKey + "\n");
    } catch (e) {}
    saveBlocksState();
    return { allowed: false, remaining: 0, resetTime: new Date(data.blockUntil), retryAfter };
  }

  rateLimitStore.set(storeKey, data);
  return { allowed: true, remaining: config.maxAttempts - data.count, resetTime: new Date(data.resetTime), retryAfter: 0 };
}

function checkSubnetRateLimit(ip, ua) {
  const result24 = checkRateLimit(getSubnet(ip, 24), "subnet24", ua);
  if (!result24.allowed) return { allowed: false, retryAfter: result24.retryAfter };
  const result16 = checkRateLimit(getSubnet(ip, 16), "subnet16", ua);
  if (!result16.allowed) return { allowed: false, retryAfter: result16.retryAfter };
  return { allowed: true, retryAfter: 0 };
}

setInterval(() => {
  const now = Date.now();
  for (const [key, data] of rateLimitStore.entries()) {
    if (data.blocked && data.blockUntil <= now) {
      logBlockExpired(key, data);
      rateLimitStore.delete(key);
    } else if (!data.blocked && data.resetTime < now) {
      rateLimitStore.delete(key);
    }
  }
  for (const [key, esc] of escalationStore.entries()) {
    if (esc.expiresAt < now) escalationStore.delete(key);
  }
  saveBlocksState();
}, 5 * 60 * 1000);

module.exports = {
  getAgentType,
  getClientIP,
  getSubnet,
  summarizeUA,
  checkRateLimit,
  checkSubnetRateLimit,
  RATE_LIMITS,
};
