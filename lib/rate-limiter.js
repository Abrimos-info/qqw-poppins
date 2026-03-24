"use strict";

const fs = require("fs");
const path = require("path");

/**
 * Rate Limiter Module
 * Simple in-memory rate limiting for authentication endpoints
 *
 * [AUTH] - All auth-related code uses this prefix for easy removal
 *
 * WARNING: This is an in-memory implementation suitable for single-server deployments.
 * For multi-server deployments, use Redis-based rate limiting instead.
 */

const BLOCK_LOG_PATH = path.join(__dirname, "..", "logs", "rate-limit-blocks.log");
const BLOCKS_STATE_PATH = path.join(__dirname, "..", "logs", "rate-limit-state.json");
const COUNTRY_STATS_PATH = path.join(__dirname, "..", "logs", "country-stats.log");

// Maximum escalation multiplier (caps at 2^MAX_ESCALATION_LEVEL = 64x base duration)
const MAX_ESCALATION_LEVEL = 6;


// Store for rate limit tracking: { key: { count, resetTime } }
const rateLimitStore = new Map();

// Track escalation levels per key: { storeKey: { level, expiresAt } }
// Escalation decays after ESCALATION_DECAY_MS of no new blocks
const ESCALATION_DECAY_MS = 6 * 60 * 60 * 1000; // 6 hours
const escalationStore = new Map();

// Country request stats: { CC: { [tag]: { vis, ips: Set<ip>, blk: Set<ip> } } }
const countryStats = new Map();

// ASN request stats: { ASN: { org, country, [tag]: { vis, ips: Set<ip>, blk: Set<ip> } } }
const asnStats = new Map();

function _ccEntry(country, userTag) {
  let cc = countryStats.get(country);
  if (!cc) { cc = {}; countryStats.set(country, cc); }
  if (!cc[userTag]) cc[userTag] = { vis: 0, ips: new Set(), blk: new Set() };
  return cc[userTag];
}

function _asnEntry(asn, asnOrg, country, userTag) {
  let s = asnStats.get(asn);
  if (!s) { s = { org: asnOrg || "", country: country || "" }; asnStats.set(asn, s); }
  if (asnOrg && !s.org) s.org = asnOrg;
  if (!s[userTag]) s[userTag] = { vis: 0, ips: new Set(), blk: new Set() };
  return s[userTag];
}

/**
 * Record a request by country. Call once per request after userTag is known.
 * @param {string} country - ISO 3166-1 alpha-2 code
 * @param {string} userTag - "U=SUB" | "U=FRE" | "A=CRW" | "A=BOT" | "A=NON"
 * @param {string} ip
 * @param {string} [asn] - Autonomous System Number (e.g. "16509")
 * @param {string} [asnOrg] - ASN organization name (e.g. "AMAZON-02")
 */
function trackCountry(country, userTag, ip, asn, asnOrg) {
  if (!country || !userTag || !ip) return;
  const e = _ccEntry(country, userTag);
  e.vis++;
  e.ips.add(ip);
  if (asn) {
    const a = _asnEntry(asn, asnOrg, country, userTag);
    a.vis++;
    a.ips.add(ip);
  }
}

/**
 * Record a blocked IP by country and userTag.
 * @param {string} country
 * @param {string} userTag - tag inferred from limitType at block site
 * @param {string} ip
 * @param {string} [asn]
 * @param {string} [asnOrg]
 */
function trackCountryBlock(country, userTag, ip, asn, asnOrg) {
  if (!country || !userTag || !ip) return;
  const e = _ccEntry(country, userTag);
  e.blk.add(ip);
  if (asn) {
    const a = _asnEntry(asn, asnOrg, country, userTag);
    a.blk.add(ip);
  }
}

/**
 * Load persisted blocks from file on startup
 */
function loadBlocksState() {
  try {
    if (!fs.existsSync(BLOCKS_STATE_PATH)) return;
    const raw = fs.readFileSync(BLOCKS_STATE_PATH, "utf8");
    const state = JSON.parse(raw);
    const now = Date.now();
    let loaded = 0;
    let expired = 0;
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
            expiresAt: entry.escalationExpiresAt || (entry.blockUntil + ESCALATION_DECAY_MS),
          });
        }
        loaded++;
      } else {
        expired++;
      }
    }
    // Restore escalation history (may outlive blocks)
    let escalationsLoaded = 0;
    for (const entry of state.escalations || []) {
      if (entry.expiresAt > now && !escalationStore.has(entry.key)) {
        escalationStore.set(entry.key, { level: entry.level, expiresAt: entry.expiresAt });
        escalationsLoaded++;
      }
    }
    if (loaded > 0 || expired > 0 || escalationsLoaded > 0) {
      console.log(`[RATE-LIMIT] Loaded ${loaded} active blocks, ${escalationsLoaded} escalation histories from state file (${expired} expired blocks discarded)`);
    }
  } catch (e) {
    console.error("[RATE-LIMIT] Failed to load blocks state:", e.message);
  }
}

/**
 * Persist active blocks to file
 */
function ensureLogsDir() {
  const logDir = path.dirname(BLOCK_LOG_PATH);
  if (!fs.existsSync(logDir)) {
    fs.mkdirSync(logDir, { recursive: true });
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
    // Save escalation entries that may outlive their blocks
    const escalations = [];
    for (const [key, esc] of escalationStore.entries()) {
      if (esc.expiresAt > now) {
        escalations.push({ key, level: esc.level, expiresAt: esc.expiresAt });
      }
    }
    fs.writeFileSync(BLOCKS_STATE_PATH, JSON.stringify({ savedAt: new Date().toISOString(), blocks, escalations }, null, 2));
  } catch (e) {
    console.error("[RATE-LIMIT] Failed to save blocks state:", e.message);
  }
}

// Load state on startup
loadBlocksState();

// Cleanup old entries every 5 minutes + persist state
setInterval(
  () => {
    const now = Date.now();
    for (const [key, data] of rateLimitStore.entries()) {
      if (data.blocked && data.blockUntil <= now) {
        // Block just expired — log it
        logBlockExpired(key, data);
        rateLimitStore.delete(key);
      } else if (!data.blocked && data.resetTime < now) {
        rateLimitStore.delete(key);
      }
    }
    // Clean up expired escalation entries
    for (const [key, esc] of escalationStore.entries()) {
      if (esc.expiresAt < now) {
        escalationStore.delete(key);
      }
    }
    saveBlocksState();
  },
  5 * 60 * 1000,
);

const COUNTRY_STATS_WINDOW_MS = 30 * 60 * 1000;
const TAG_ORDER = ["U=SUB", "U=FRE", "A=NON", "A=BOT", "A=CRW"];
const BLOCKED_KEY = "BLOCKED";
let countryStatsWindowStart = Date.now();

setInterval(flushCountryStats, 60 * 1000);
setInterval(() => {
  countryStats.clear();
  asnStats.clear();
  countryStatsWindowStart = Date.now();
}, COUNTRY_STATS_WINDOW_MS);

/**
 * Write accumulated country stats to log (every 1 min). Stats reset every 30 min.
 */
function flushCountryStats() {
  if (countryStats.size === 0) return;

  const tagVis  = (cc, tag) => (cc[tag] ? cc[tag].vis        : 0);
  const tagUip  = (cc, tag) => (cc[tag] ? cc[tag].ips.size   : 0);
  const tagBlk  = (cc, tag) => (cc[tag] ? cc[tag].blk.size   : 0);
  const ccVis   = (cc) => TAG_ORDER.reduce((a, t) => a + tagVis(cc, t), 0);
  const ccUip   = (cc) => { const all = new Set(); TAG_ORDER.forEach((t) => cc[t] && cc[t].ips.forEach((ip) => all.add(ip))); return all.size; };
  const ccBlk   = (cc) => { const all = new Set(); TAG_ORDER.forEach((t) => cc[t] && cc[t].blk.forEach((ip) => all.add(ip))); return all.size; };

  const sorted = [...countryStats.entries()].sort((a, b) => ccVis(b[1]) - ccVis(a[1]));

  const now = new Date();
  const elapsedMin = Math.round((Date.now() - countryStatsWindowStart) / 60000);

  const pad  = (v, w) => String(v === 0 ? "-" : v).padStart(w);
  const dash = (w) => "-".repeat(w);
  const center = (label, w) => {
    const left = Math.floor((w - label.length) / 2);
    return " ".repeat(left) + label + " ".repeat(w - label.length - left);
  };

  // Only show tags that have any data
  const activeTags = TAG_ORDER.filter((tag) => sorted.some(([, cc]) => cc[tag]));

  // Sub-column width: uniform per group, max of vis/uip/blk values and min 3
  const subW = (tag) => {
    const maxVal = Math.max(
      ...sorted.flatMap(([, cc]) => [tagVis(cc, tag), tagUip(cc, tag), tagBlk(cc, tag)])
    );
    return Math.max(3, String(maxVal).length);
  };
  const tagSW = Object.fromEntries(activeTags.map((t) => [t, subW(t)]));

  // TOTAL sub-column widths (vis/uip/blk may differ)
  const totVisW = Math.max(3, String(ccVis(sorted[0][1])).length);
  const totUipW = Math.max(3, String(Math.max(...sorted.map(([, cc]) => ccUip(cc)))).length);
  const totBlkW = Math.max(3, String(Math.max(...sorted.map(([, cc]) => ccBlk(cc)))).length);

  const GAP = "   ";
  // Group content width = 3 sub-cols + 2 separators
  const groupW  = (sw) => sw * 3 + 4;
  const subHdr  = (vw, uw, bw) => `${"vis".padStart(vw)}  ${"uip".padStart(uw)}  ${"blk".padStart(bw)}`;
  const subSep  = (vw, uw, bw) => `${dash(vw)}  ${dash(uw)}  ${dash(bw)}`;
  const subCols = (vis, uip, blk, vw, uw, bw) => `${pad(vis, vw)}  ${pad(uip, uw)}  ${pad(blk, bw)}`;

  const totGW = totVisW + totUipW + totBlkW + 4;

  const header1 = [
    "  CC",
    center("TOTAL", totGW),
    ...activeTags.map((t) => center(t, groupW(tagSW[t]))),
  ].join(GAP);

  const header2 = [
    "    ",
    subHdr(totVisW, totUipW, totBlkW),
    ...activeTags.map((t) => subHdr(tagSW[t], tagSW[t], tagSW[t])),
  ].join(GAP);

  const sepLine = [
    "  ----",
    subSep(totVisW, totUipW, totBlkW),
    ...activeTags.map((t) => subSep(tagSW[t], tagSW[t], tagSW[t])),
  ].join(GAP);

  const rows = sorted.map(([cc, s]) => [
    `  ${cc}`,
    subCols(ccVis(s), ccUip(s), ccBlk(s), totVisW, totUipW, totBlkW),
    ...activeTags.map((t) => subCols(tagVis(s, t), tagUip(s, t), tagBlk(s, t), tagSW[t], tagSW[t], tagSW[t])),
  ].join(GAP));

  const lines = [
    `[COUNTRY-STATS] ${now.toISOString()}  (last ${elapsedMin}m)`,
    header1, header2, sepLine, ...rows,
  ];

  // ASN table — top entries sorted by total blocked IPs, then total visits
  if (asnStats.size > 0) {
    const asnVis  = (s) => TAG_ORDER.reduce((a, t) => a + (s[t] ? s[t].vis : 0), 0);
    const asnUip  = (s) => { const all = new Set(); TAG_ORDER.forEach((t) => s[t] && s[t].ips.forEach((ip) => all.add(ip))); return all.size; };
    const asnBlk  = (s) => { const all = new Set(); TAG_ORDER.forEach((t) => s[t] && s[t].blk.forEach((ip) => all.add(ip))); return all.size; };

    const asnSorted = [...asnStats.entries()]
      .sort((a, b) => asnBlk(b[1]) - asnBlk(a[1]) || asnVis(b[1]) - asnVis(a[1]))
      .filter(([, s]) => asnVis(s) > 0 || asnBlk(s) > 0)
      .slice(0, 30);

    if (asnSorted.length > 0) {
      const aVW = Math.max(3, String(Math.max(...asnSorted.map(([, s]) => asnVis(s)))).length);
      const aUW = Math.max(3, String(Math.max(...asnSorted.map(([, s]) => asnUip(s)))).length);
      const aBW = Math.max(3, String(Math.max(...asnSorted.map(([, s]) => asnBlk(s)))).length);
      const orgW = Math.max(4, Math.min(28, Math.max(...asnSorted.map(([, s]) => (s.org || "").length))));
      const asnW = Math.max(8, Math.max(...asnSorted.map(([k]) => ("AS" + k).length)));

      const aHdr1  = `  ${"ASN".padEnd(asnW)}  ${"ORG".padEnd(orgW)}  CC   ${"vis".padStart(aVW)}  ${"uip".padStart(aUW)}  ${"blk".padStart(aBW)}`;
      const aHdr2  = `  ${"-".repeat(asnW)}  ${"-".repeat(orgW)}  --   ${"-".repeat(aVW)}  ${"-".repeat(aUW)}  ${"-".repeat(aBW)}`;
      const aRows  = asnSorted.map(([asn, s]) => {
        const org = (s.org || "").slice(0, orgW).padEnd(orgW);
        const cc  = (s.country || "--").padEnd(2).slice(0, 2);
        return `  ${"AS" + asn.padEnd(asnW - 2)}  ${org}  ${cc}   ${pad(asnVis(s), aVW)}  ${pad(asnUip(s), aUW)}  ${pad(asnBlk(s), aBW)}`;
      });
      lines.push("", "[ASN-STATS]", aHdr1, aHdr2, ...aRows);
    }
    asnStats.clear();
  }

  const block = lines.join("\n");
  console.log(block);
  fs.appendFile(COUNTRY_STATS_PATH, block + "\n", () => {});
}

/**
 * Log when a block expires
 */
function logBlockExpired(storeKey, data) {
  const uaShort = summarizeUA(data.ua);
  const level = (escalationStore.get(storeKey) || {}).level || 0;
  const escalationInfo = level > 0 ? ` (escalation level ${level})` : "";
  const line = `✅ [RATE-LIMIT] Block expired ${storeKey} | ua: ${uaShort}${escalationInfo}`;
  console.log(line);
  fs.appendFile(BLOCK_LOG_PATH, new Date().toISOString() + "  " + line + "\n", () => {});
}

/**
 * Rate limit configurations for different endpoints
 */
const RATE_LIMITS = {
  // Login: 5 attempts per 15 minutes per IP
  login: {
    maxAttempts: 5,
    windowMs: 15 * 60 * 1000, // 15 minutes
    blockDurationMs: 15 * 60 * 1000, // Block for 15 minutes after exceeded
  },
  // Registration: 10 attempts per hour per IP
  register: {
    maxAttempts: 10,
    windowMs: 60 * 60 * 1000, // 1 hour
    blockDurationMs: 60 * 60 * 1000,
  },
  // Password reset request: 3 attempts per 15 minutes per IP
  passwordReset: {
    maxAttempts: 3,
    windowMs: 15 * 60 * 1000,
    blockDurationMs: 15 * 60 * 1000,
  },
  // Email verification: 10 attempts per 15 minutes per IP
  verifyEmail: {
    maxAttempts: 10,
    windowMs: 15 * 60 * 1000,
    blockDurationMs: 15 * 60 * 1000,
  },
  // Account-specific login: 10 attempts per 15 minutes per email (protects against credential stuffing)
  loginByEmail: {
    maxAttempts: 10,
    windowMs: 15 * 60 * 1000,
    blockDurationMs: 30 * 60 * 1000, // Longer block for account-specific attacks
  },
  // Search engine crawlers: 600 requests per minute per IP (Google, Bing, Yandex, etc.)
  crawler: {
    maxAttempts: 600,
    windowMs: 60 * 1000, // 1 minute
    blockDurationMs: 5 * 60 * 1000, // Block for 5 minutes
  },
  // SEO/scraper bots: 30 requests per minute per IP (Semrush, Ahrefs, etc.)
  bot: {
    maxAttempts: 30,
    windowMs: 60 * 1000, // 1 minute
    blockDurationMs: 5 * 60 * 1000, // Block for 5 minutes
  },
  // Any IP: 1000 requests per 5 minutes (catch aggressive bots with fake UAs)
  global: {
    maxAttempts: 1000,
    windowMs: 5 * 60 * 1000, // 5 minutes
    blockDurationMs: 10 * 60 * 1000, // Block for 10 minutes
  },
  // Resend verification email: 10 attempts per 15 minutes per IP
  resendVerification: {
    maxAttempts: 10,
    windowMs: 15 * 60 * 1000,
    blockDurationMs: 15 * 60 * 1000,
  },
  // Resend verification by email: 5 attempts per hour per email
  resendVerificationByEmail: {
    maxAttempts: 5,
    windowMs: 60 * 60 * 1000,
    blockDurationMs: 60 * 60 * 1000,
  },
  // Subnet /24: catches rotating IPs within same /24 block
  subnet24: {
    maxAttempts: 200,
    windowMs: 5 * 60 * 1000,
    blockDurationMs: 10 * 60 * 1000,
  },
  // Subnet /16: catches rotating IPs across a wider range
  subnet16: {
    maxAttempts: 500,
    windowMs: 5 * 60 * 1000,
    blockDurationMs: 15 * 60 * 1000,
  },
  // Country-based limits. maxAttempts: 0 = hard block (444 silent drop).
  "country:SG": { maxAttempts: 0, windowMs: 0, blockDurationMs: 0 },                          // hard block
  "country:CN": { maxAttempts: 5, windowMs: 5 * 60 * 1000, blockDurationMs: 30 * 60 * 1000 }, // soft
  "country:HK": { maxAttempts: 5, windowMs: 5 * 60 * 1000, blockDurationMs: 30 * 60 * 1000 }, // soft
  "country:NL": { maxAttempts: 5, windowMs: 5 * 60 * 1000, blockDurationMs: 30 * 60 * 1000 }, // soft
  "country:FR": { maxAttempts: 5, windowMs: 5 * 60 * 1000, blockDurationMs: 30 * 60 * 1000 }, // soft
  "country:IE": { maxAttempts: 5, windowMs: 5 * 60 * 1000, blockDurationMs: 30 * 60 * 1000 }, // soft — Dublin is major EU cloud hub (AWS, Cloudflare), 146 visits from 3 IPs observed
};

// Search engine crawlers — used for getAgentType and rate limit classification
const CRAWLER_UA_RE = /googlebot|bingbot|yandex|slurp|baiduspider|duckduckbot|mediapartners-google|adsbot-google|apis-google|applebot|google-read-aloud/i;
// SEO tools, scrapers & any UA containing "bot" — strict limit
const BOT_UA_RE = /bot|semrush|ahref|bytespider|sogou|serpstat|dataforseo|oai-searchbot|headlesschrome|crawler|facebookexternalhit|hubspot|newsai/i;
// Headless renderers used by search engines
const RENDERER_UA_RE = /Nexus 5X Build\/MMB29P/i;

/**
 * Classify request by User-Agent for rate limiting and analytics (crawler / bot / human).
 * @param {Object} req - HTTP request (with headers)
 * @returns {string|null} "crawler" | "bot" | null
 */
function getAgentType(req) {
  const ua = (req && req.headers && req.headers["user-agent"]) || "";
  const isPlaywrightInDev =
    process.env.NODE_ENV !== "production" &&
    /playwright|headlesschrome|headless/i.test(ua);
  if (isPlaywrightInDev) return null;
  if (CRAWLER_UA_RE.test(ua)) return "crawler";
  if (BOT_UA_RE.test(ua)) return "bot";
  if (RENDERER_UA_RE.test(ua)) return "crawler";
  if (!ua || !req.headers["accept-language"]) return "bot";
  return null;
}

/**
 * Get client IP from request
 * Prefers proxy headers set by nginx, falls back to socket address
 * @param {Object} req - HTTP request
 * @returns {string} Client IP address
 */
function getClientIP(req) {
  // Prefer X-Real-IP — set by the reverse proxy, cannot be spoofed by clients
  const realIP = req.headers["x-real-ip"];
  if (realIP) {
    return realIP;
  }

  // X-Forwarded-For — take the last IP (appended by nginx, not client-controlled)
  const forwardedFor = req.headers["x-forwarded-for"];
  if (forwardedFor) {
    const ips = forwardedFor.split(",").map((ip) => ip.trim());
    return ips[ips.length - 1];
  }

  // Fallback to socket address (direct connection or no proxy)
  return (
    req.socket?.remoteAddress || req.connection?.remoteAddress || "unknown"
  );
}

/**
 * Extract a short bot/browser name from a user agent string
 */
function summarizeUA(ua) {
  if (!ua) return "";
  // Known bot patterns — extract name + version
  const botMatch = ua.match(/(googlebot|bingbot|yandexbot|semrushbot|ahrefsbot|mj12bot|dotbot|petalbot|bytespider|duckduckbot|sogou|serpstatbot|dataforseobot|zoominfobot|gptbot|oai-searchbot|mediapartners-google|adsbot-google|apis-google|facebookexternalhit|twitterbot|linkedinbot|slurp|baiduspider|applebot|google-read-aloud|headlesschrome|hubspot|newsai)[\/\s]?([^\s;)]*)?/i);
  if (botMatch) return botMatch[2] ? `${botMatch[1]}/${botMatch[2]}` : botMatch[1];
  // Browser fallback
  const browserMatch = ua.match(/(Chrome|Firefox|Safari|Edge|Opera)[\/\s]?([\d.]+)?/);
  if (browserMatch) return `${browserMatch[1]}/${browserMatch[2] || "?"}`;
  // Last resort — tail is more distinctive than the common Mozilla/5.0 prefix
  return ua.length > 40 ? "…" + ua.slice(-40) : ua;
}

/**
 * Check if a request is rate limited
 * @param {string} key - Unique identifier (IP or email)
 * @param {string} limitType - Type of rate limit to apply
 * @returns {Object} { allowed: boolean, remaining: number, resetTime: Date, retryAfter: number }
 */
function checkRateLimit(key, limitType, ua, country) {
  const config = RATE_LIMITS[limitType];
  if (!config) {
    console.error(
      new Date(),
      "[AUTH] rate-limiter: Unknown limit type:",
      limitType,
    );
    return { allowed: true, remaining: 999, resetTime: null, retryAfter: 0 };
  }

  const now = Date.now();
  const storeKey = `${limitType}:${key}`;
  let data = rateLimitStore.get(storeKey);

  // If no data or window has expired (and not actively blocked), create new entry.
  // Do NOT reset a block just because the rate-limit window rolled over — the block
  // duration is independent of the counting window and is often much longer.
  if (!data || (data.resetTime < now && !data.blocked)) {
    data = {
      count: 0,
      resetTime: now + config.windowMs,
      blocked: false,
      blockUntil: 0,
      ua: ua || "",
      country: country || "",
    };
  }

  // Update UA and country on each request (keep the latest)
  if (ua) data.ua = ua;
  if (country) data.country = country;

  // Check if currently blocked (no log here — logged once when limit is first exceeded)
  if (data.blocked && data.blockUntil > now) {
    const retryAfter = Math.ceil((data.blockUntil - now) / 1000);
    return {
      allowed: false,
      remaining: 0,
      resetTime: new Date(data.blockUntil),
      retryAfter,
    };
  }

  // Reset block if block duration has passed
  if (data.blocked && data.blockUntil <= now) {
    // Block just expired inline — log it
    logBlockExpired(storeKey, data);
    data.blocked = false;
    data.count = 0;
    data.resetTime = now + config.windowMs;
  }

  // Increment count
  data.count++;

  // Check if limit exceeded
  if (data.count > config.maxAttempts) {
    // Escalate: increase block duration based on repeat offenses
    const prevLevel = (escalationStore.get(storeKey) || {}).level || 0;
    const level = Math.min(prevLevel + 1, MAX_ESCALATION_LEVEL);
    const escalatedDuration = config.blockDurationMs * Math.pow(2, level - 1);

    data.blocked = true;
    data.blockUntil = now + escalatedDuration;
    escalationStore.set(storeKey, { level, expiresAt: data.blockUntil + ESCALATION_DECAY_MS });
    rateLimitStore.set(storeKey, data);

    const retryAfter = Math.ceil(escalatedDuration / 1000);
    // Log blocked entry + top offenders (count >= 10 or blocked)
    const windowSec = Math.ceil(config.windowMs / 1000);
    const blockSec = Math.ceil(escalatedDuration / 1000);
    const baseSec = Math.ceil(config.blockDurationMs / 1000);
    const escalationInfo = level > 1 ? ` (level ${level}, base ${baseSec}s)` : "";
    const countryTag = data.country ? ` | country: ${data.country}` : "";
    const lines = [
      `⛔ [RATE-LIMIT] Blocked ${storeKey} | Rule: ${config.maxAttempts} reqs/${windowSec}s, blocked for ${blockSec}s${escalationInfo}${countryTag} | ${rateLimitStore.size} tracked IPs`,
    ];
    for (const [k, v] of rateLimitStore.entries()) {
      const type = k.split(":")[0];
      const ruleConfig = RATE_LIMITS[type];
      const threshold = ruleConfig ? Math.ceil(ruleConfig.maxAttempts * 0.8) : 10;
      if (v.blocked || v.count >= threshold) {
        const kLevel = (escalationStore.get(k) || {}).level || 0;
        const kBaseDuration = ruleConfig ? ruleConfig.blockDurationMs : 0;
        const kActualDuration = kLevel > 0 ? kBaseDuration * Math.pow(2, kLevel - 1) : kBaseDuration;
        const rule = ruleConfig
          ? `${ruleConfig.maxAttempts}/${Math.ceil(ruleConfig.windowMs / 1000)}s → block ${Math.ceil(kActualDuration / 1000)}s`
          : "?";
        const levelTag = kLevel > 1 ? ` L${kLevel}` : "";
        const flag = v.blocked ? "🚫 BLOCKED" : "⚠️  warning";
        const uaShort = summarizeUA(v.ua);
        const cc = v.country ? ` [${v.country}]` : "";
        lines.push(`  ${flag}  ${k.padEnd(35)} count: ${String(v.count).padStart(4)}  ttl: ${Math.ceil(((v.blocked ? v.blockUntil : v.resetTime) - now) / 1000)}s  (${rule})${levelTag}${cc}  ua: ${uaShort}`);
      }
    }
    console.log(lines.join("\n"));
    // Write only the primary block line to disk — offender table is console-only to avoid log bloat
    fs.appendFile(BLOCK_LOG_PATH, new Date().toISOString() + "  " + lines[0] + "\n", () => {});

    // Persist state after new block
    saveBlocksState();

    return {
      allowed: false,
      remaining: 0,
      resetTime: new Date(data.blockUntil),
      retryAfter,
    };
  }

  rateLimitStore.set(storeKey, data);

  return {
    allowed: true,
    remaining: config.maxAttempts - data.count,
    resetTime: new Date(data.resetTime),
    retryAfter: 0,
  };
}

/**
 * Reset rate limit for a specific key (e.g., after successful login)
 * @param {string} key - Unique identifier
 * @param {string} limitType - Type of rate limit
 */
function resetRateLimit(key, limitType) {
  const storeKey = `${limitType}:${key}`;
  rateLimitStore.delete(storeKey);
  // Don't reset escalation — a successful login shouldn't reset the escalation
  // for brute-force attempts. Escalation decays naturally when entries are cleaned up.
  console.log(new Date(), "[AUTH] rate-limiter: Rate limit reset", {
    key: storeKey,
  });
}

/**
 * Middleware-style rate limit checker for auth endpoints
 * @param {Object} req - HTTP request
 * @param {string} limitType - Type of rate limit
 * @param {string} additionalKey - Optional additional key (e.g., email for account-specific limiting)
 * @returns {Object|null} Rate limit error response or null if allowed
 */
function checkAuthRateLimit(req, limitType, additionalKey = null) {
  const ip = getClientIP(req);
  const ua = (req.headers && req.headers["user-agent"]) || "";

  // Check IP-based rate limit
  const ipResult = checkRateLimit(ip, limitType, ua);
  if (!ipResult.allowed) {
    return {
      json: {
        error: "Too many requests. Please try again later.",
        code: "rate_limited",
        retryAfter: ipResult.retryAfter,
      },
      status: 429,
      headers: {
        "Retry-After": ipResult.retryAfter.toString(),
        "X-RateLimit-Remaining": "0",
        "X-RateLimit-Reset": ipResult.resetTime.toISOString(),
      },
    };
  }

  // Check additional key-based rate limit (e.g., email)
  if (additionalKey) {
    const keyResult = checkRateLimit(
      additionalKey.toLowerCase(),
      limitType + "ByEmail",
    );
    if (!keyResult.allowed) {
      return {
        json: {
          error: "Too many requests for this account. Please try again later.",
          code: "rate_limited",
          retryAfter: keyResult.retryAfter,
        },
        status: 429,
        headers: {
          "Retry-After": keyResult.retryAfter.toString(),
        },
      };
    }
  }

  return null; // Allowed
}

/**
 * Get current rate limit stats (for debugging/monitoring)
 * @returns {Object} Stats about current rate limits
 */
function getRateLimitStats() {
  const stats = {
    totalEntries: rateLimitStore.size,
    entriesByType: {},
  };

  for (const [key] of rateLimitStore.entries()) {
    const type = key.split(":")[0];
    stats.entriesByType[type] = (stats.entriesByType[type] || 0) + 1;
  }

  return stats;
}

/**
 * Check country-based access rules (hard block or soft rate limit).
 * Soft blocks are per-IP so individual visitors each get the full quota.
 * @param {string} country - ISO 3166-1 alpha-2 code (e.g. "SG")
 * @param {string} [ip] - Client IP (used as key for per-IP soft limiting)
 * @param {string} [ua] - User-Agent (for logging)
 * @returns {{ allowed: boolean, hard?: boolean, retryAfter?: number }}
 */
function checkCountryBlock(country, ip, ua) {
  if (!country) return { allowed: true };
  const config = RATE_LIMITS[`country:${country}`];
  if (!config) return { allowed: true };
  if (config.maxAttempts === 0) return { allowed: false, hard: true };
  const result = checkRateLimit(ip || "all", `country:${country}`, ua, country);
  return { allowed: result.allowed, hard: false, retryAfter: result.retryAfter };
}

/**
 * Extract subnet prefix from an IP address
 * IPv4: /24 → first 3 octets, /16 → first 2 octets
 * IPv6: /48 → first 3 groups, /32 → first 2 groups
 * @param {string} ip - IP address
 * @param {number} prefixBits - 16 or 24 for IPv4, 32 or 48 for IPv6
 * @returns {string} Subnet key (e.g. "43.173.55.x/24")
 */
function getSubnet(ip, prefixBits) {
  const normalized = ip.startsWith("::ffff:") ? ip.slice(7) : ip;

  if (normalized.includes(":")) {
    // IPv6 — map prefix bits: 24→48, 16→32
    const v6Bits = prefixBits <= 24 ? prefixBits * 2 : prefixBits;
    const take = Math.floor(v6Bits / 16);
    const groups = normalized.split(":");
    return groups.slice(0, Math.min(take, groups.length)).join(":") + "::/" + v6Bits;
  }

  // IPv4
  const octets = normalized.split(".");
  const take = Math.floor(prefixBits / 8);
  return octets.slice(0, take).join(".") + ".x/" + prefixBits;
}

/**
 * Check subnet-based rate limits for an IP (catches rotating-IP scrapers)
 * @param {string} ip - Client IP address
 * @param {string} ua - User-Agent string (for logging)
 * @returns {{ allowed: boolean, retryAfter: number }}
 */
function checkSubnetRateLimit(ip, ua, country) {
  const subnet24 = getSubnet(ip, 24);
  const result24 = checkRateLimit(subnet24, "subnet24", ua, country);
  const subnet24Count = result24.remaining !== undefined ? (RATE_LIMITS.subnet24.maxAttempts - result24.remaining) : 0;
  if (!result24.allowed) {
    return { allowed: false, retryAfter: result24.retryAfter, subnet24Count };
  }

  const subnet16 = getSubnet(ip, 16);
  const result16 = checkRateLimit(subnet16, "subnet16", ua, country);
  if (!result16.allowed) {
    return { allowed: false, retryAfter: result16.retryAfter, subnet24Count };
  }

  return { allowed: true, retryAfter: 0, subnet24Count };
}

function getCountryStats() {
  return new Map(countryStats);
}

/** Shallow copy of ASN aggregate stats (same shape as countryStats entries per tag). */
function getAsnStats() {
  return new Map(asnStats);
}

function resetCountryStats() {
  countryStats.clear();
  asnStats.clear();
  countryStatsWindowStart = Date.now();
}

module.exports = {
  checkRateLimit,
  checkSubnetRateLimit,
  checkCountryBlock,
  trackCountry,
  trackCountryBlock,
  getCountryStats,
  getAsnStats,
  resetCountryStats,
  resetRateLimit,
  checkAuthRateLimit,
  getClientIP,
  getSubnet,
  getRateLimitStats,
  summarizeUA,
  getAgentType,
  RATE_LIMITS,
};
