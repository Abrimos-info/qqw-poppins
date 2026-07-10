const createError = require('http-errors');
const express = require('express');
const path = require('path');
const cookieParser = require('cookie-parser');
const cacheControl = require('express-cache-controller');
const stylus = require('stylus');
const hbs = require('express-handlebars');
const dotenv = require('dotenv');
const dotenvExpand = require('dotenv-expand');
const myEnv = dotenv.config();
dotenvExpand.expand(myEnv);
const indexRouter = require('./routes/index');
const lib = require("./lib/lib");
const rateLimiter = require("./lib/rate-limiter");
const { readProxyAsnHeaders } = require("./lib/asn-proxy-headers");
const app = express();
const helpers = require("./lib/helpers.js").helpers;

// Load CSP configuration (same structure as sociedad-web-front)
let cspConfig = null;
try {
  cspConfig = JSON.parse(
    require("fs").readFileSync(path.join(__dirname, "config/csp.json"), "utf8"),
  );
} catch (e) {
  console.error("Failed to load CSP config:", e.message);
}

function buildCSPString() {
  if (!cspConfig) return null;
  const directives = [];
  Object.keys(cspConfig).forEach((directive) => {
    const sources = cspConfig[directive];
    if (Array.isArray(sources) && sources.length > 0) {
      directives.push(`${directive} ${sources.join(" ")}`);
    }
  });
  return directives.join("; ");
}

// Trust proxy for correct handling of X-Forwarded-* headers (needed for Cloudflare/proxies)
app.set('trust proxy', true);

function initApp(appLocals) {
  // console.log("appLocals general",appLocals.general);
  // console.log("appLocals buscadores",appLocals.buscadores);
  // console.log("appLocals notas",appLocals.notas);

  
  // handlebars setup
  const handlebars = hbs.engine({
    extname: 'hbs',
    defaultLayout: 'layout',
    layoutsDir: path.join(__dirname, (appLocals.general && appLocals.general.views && appLocals.general.views[0]) ? appLocals.general.views[0].staging : 'views'),
    partialsDir  : [
        //  path to your partials
        path.join(__dirname, 'views/partials'),
        path.join(__dirname, (appLocals.general && appLocals.general.partials && appLocals.general.partials[0]) ? appLocals.general.partials[0].staging : 'views/partials'),
    ],
    helpers: helpers,
  });
  app.engine('.hbs', handlebars);


  // view engine setup
  app.set('views', path.join(__dirname, 'views'));
  app.set('view engine', 'hbs');


  app.use(express.json());
  app.use(express.urlencoded({ extended: false }));
  app.use(cookieParser());

  console.log("stylus path",(appLocals.general && appLocals.general.style_path && appLocals.general.style_path[0]) ? appLocals.general.style_path[0].staging : 'public/stylesheets');
  app.use(stylus.middleware(
    {
      "serve": true,
      "dest": (appLocals.general && appLocals.general.extra_static_path) ? path.join(__dirname, appLocals.general.extra_static_path[0].staging): "public", 
      "src": path.join(__dirname, (appLocals.general && appLocals.general.style_path && appLocals.general.style_path[0]) ? appLocals.general.style_path[0].staging : 'public/stylesheets'),
      "force": true,
      "linenos": false,
    }

  ));

  const staticOptions = {
    index:false,
    cacheControl: true,
    maxAge: 60000000
  };

  app.use("/", express.static(path.join(__dirname, 'public'), staticOptions));
  
  if (appLocals.general && appLocals.general.extra_static_path) {
    app.use("/extra", express.static(path.join(__dirname, appLocals.general.extra_static_path[0].staging), staticOptions));
  }

  // Bootstrap 4 and libraries
  app.use('/jQuery', express.static(__dirname + '/node_modules/jquery/dist/',staticOptions));
  app.use('/bootstrap', express.static(__dirname + '/node_modules/bootstrap/dist/',staticOptions));
  app.use('/tiza', express.static(__dirname + '/node_modules/tiza',staticOptions));
  app.use('/datatables', express.static(__dirname + '/node_modules/datatables.net/js',staticOptions));
  app.use('/datatables-styles', express.static(__dirname + '/node_modules/datatables.net-dt/css',staticOptions));
  


  app.use(cacheControl({
    // public: true,
    noCache: true
  }
  ));

  // Apply CSP header using config/csp.json (same implementation as sociedad-web-front)
  const cspHeader = buildCSPString();
  if (cspHeader) {
    app.use(function cspMiddleware(req, res, next) {
      res.setHeader("Content-Security-Policy", cspHeader);
      next();
    });
  }

  // Rate limits aligned with sociedad-web-front (lib/router.js + lib/rate-limiter.js).
  // Static assets are served by express.static above; they do not reach this middleware.
  app.use(function rateLimitMiddleware(req, res, next) {
    req._startTime = process.hrtime();
    const ip = rateLimiter.getClientIP(req);
    const cdnVia = rateLimiter.getCDNSource(req);
    const ua = req.headers["user-agent"] || "";
    const country = req.headers["x-country-code"] || "";
    const { asn, asnOrg } = readProxyAsnHeaders(req.headers);
    const limitType = rateLimiter.getAgentType(req);
    const limitTag =
      limitType === "preview" ? "A=PRV"
      : limitType === "crawler" ? "A=CRW"
      : limitType === "bot" ? "A=BOT"
      : "A=NON";

    // Link-preview crawlers (FB/IG/Slack/X/etc.) and AI indexers (GPTBot) are exempted
    // from country soft-blocks — they often hit from cloud-region IPs (e.g. FB-NL) that
    // would otherwise be caught by the country soft-block before their own bucket.
    const countryCheck = limitType === "preview"
      ? { allowed: true }
      : rateLimiter.checkCountryBlock(country, ip, ua);
    if (!countryCheck.allowed) {
      rateLimiter.trackCountryBlock(country, limitTag, ip, asn, asnOrg);
      if (countryCheck.hard) {
        return res.status(444).end();
      }
      res.set("Retry-After", String(countryCheck.retryAfter));
      return res.status(429).send("Too Many Requests");
    }

    if (limitType) {
      const check = rateLimiter.checkRateLimit(ip, limitType, ua, country, cdnVia);
      if (!check.allowed) {
        rateLimiter.trackCountryBlock(country, limitTag, ip, asn, asnOrg);
        res.set("Retry-After", String(check.retryAfter));
        return res.status(429).send("Too Many Requests");
      }
    }

    const globalCheck = rateLimiter.checkRateLimit(ip, "global", ua, country, cdnVia);
    if (!globalCheck.allowed) {
      rateLimiter.trackCountryBlock(country, limitTag, ip, asn, asnOrg);
      res.set("Retry-After", String(globalCheck.retryAfter));
      return res.status(429).send("Too Many Requests");
    }

    const isLocalhostInDev =
      process.env.NODE_ENV !== "production" &&
      (ip === "127.0.0.1" || ip === "::1" || ip === "::ffff:127.0.0.1");
    let subnetCheck = null;
    if (!limitType && !isLocalhostInDev) {
      subnetCheck = rateLimiter.checkSubnetRateLimit(ip, ua, country, cdnVia);
      if (!subnetCheck.allowed) {
        rateLimiter.trackCountryBlock(country, limitTag, ip, asn, asnOrg);
        res.set("Retry-After", String(subnetCheck.retryAfter));
        return res.status(429).send("Too Many Requests");
      }
    }

    req._ip = ip;
    req._cdnVia = cdnVia;
    req._country = country;
    req._asn = asn;
    req._asnOrg = asnOrg;
    req._limitType = limitType;
    req.userTag = limitTag;
    req._reqCount = globalCheck.count;
    req._subnetCount = subnetCheck ? subnetCheck.subnet24Count : undefined;
    req._uaShort = rateLimiter.summarizeUA(ua);

    // Fixed-width log prefix, same layout as sociedad-web-front (lib/router.js):
    // date time method duration userTag IP reqCount/subnetCount country cdnVia UA
    req.logPrefix = () => {
      const d = new Date();
      const logDate = String(d.getFullYear()) + String(d.getMonth() + 1).padStart(2, "0") + String(d.getDate()).padStart(2, "0");
      const logTime = String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0") + ":" + String(d.getSeconds()).padStart(2, "0");
      const ut = (req.userTag || "A=???").padEnd(5).slice(0, 5);
      const method = (req.method || "???").padEnd(4);
      const rawIp = req._ip || "";
      const logIp = (rawIp.length > 15 ? rawIp.slice(0, 14) + "…" : rawIp).padEnd(15);
      const rc = String(req._reqCount ?? "?").padStart(4);
      const sc = req._subnetCount ? "/" + String(req._subnetCount).padEnd(3) : "    ";
      let dur = "   ?ms";
      if (req._startTime) {
        const [s, ns] = process.hrtime(req._startTime);
        dur = (((s * 1000 + ns / 1e6) | 0) + "ms").padStart(6);
      }
      const cc = (req._country || "--").padEnd(2).slice(0, 2);
      const via = (req._cdnVia || "---").padEnd(3).slice(0, 3);
      const uaCol = (req._uaShort || "").padEnd(20).slice(0, 20);
      return `${logDate} ${logTime} ${method} ${dur} ${ut} ${logIp} ${rc}${sc} ${cc} ${via} ${uaCol}`;
    };

    res.on("finish", () => {
      if (!req._limitType) {
        // Real users: always log
        console.log(req.logPrefix(), res.statusCode, req.originalUrl);
      } else if (process.env.NODE_ENV !== "production" || req.method !== "GET") {
        // Bots/crawlers: always in dev; in prod only for non-GET
        console.log(req.logPrefix(), res.statusCode, req.originalUrl);
      } else if (req.originalUrl.includes("?")) {
        // Bots/crawlers in prod: log GETs with query params, except when only param is `lang`
        try {
          const u = new URL(req.originalUrl, "http://localhost");
          const params = new URLSearchParams(u.searchParams);
          params.delete("lang");
          if (params.toString().length > 0) {
            console.log(req.logPrefix(), res.statusCode, req.originalUrl);
          }
        } catch (e) {
          console.log(req.logPrefix(), res.statusCode, req.originalUrl);
        }
      }
    });

    if (limitType && req.method === "POST") {
      return res.status(403).send("Forbidden");
    }

    rateLimiter.trackCountry(country, limitTag, ip, asn, asnOrg);
    next();
  });

  app.use('/', indexRouter);

  console.log("App started, server listening. Env",helpers.env());

  // catch 404 and forward to error handler
  app.use(function(req, res, next) {
    next(createError(404));
  });

  // error handler
  app.use(function(err, req, res, next) {
    //Don't show trace for 404 errors
    if (err.message!="Not Found") {
      // set locals, only providing error in development
      res.locals.error = req.app.get('env') === 'development' ? err : {};
      res.locals.message = err.message;
  
      console.error("/!\\ QuienEsQuien.Wiki APP Error at URL: ",req.url);
      console.error("/!\\ QuienEsQuien.Wiki APP Error: ",err);
    }

    res.cacheControl = {
      noStore: true
    }
    // render the error page
    res.status(err.status || 500);
    res.render('error', { error: true, current_url: req.url });
  });

  //Last resource error handler.
  app.use(function(err, req, res, next) {
    res.status(404);
    res.json({
      en: "We will recover from this too. Please reload the page. If this message repeats, please let us know.",
      es: "Nos vamos a recuperar de esta. Por favor refresque la página. Si este mensaje se repite por favor infórmenos."
    });
  });
}


lib.loadSettings(app,initApp);


module.exports = app;
