const createError = require('http-errors');
const express = require('express');
const path = require('path');
const cookieParser = require('cookie-parser');
const morgan = require('morgan');
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


  // log only 4xx and 5xx responses to console
  app.use(morgan('short', {
    skip: function (req, res) { return (res.statusCode < 400 && (req.headers.accept && req.headers.accept.indexOf("html") == -1 )) }
  }))

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
    const ip = rateLimiter.getClientIP(req);
    const ua = req.headers["user-agent"] || "";
    const country = req.headers["x-country-code"] || "";
    const { asn, asnOrg } = readProxyAsnHeaders(req.headers);
    const limitType = rateLimiter.getAgentType(req);
    const limitTag =
      limitType === "crawler" ? "A=CRW" : limitType === "bot" ? "A=BOT" : "A=NON";

    const countryCheck = rateLimiter.checkCountryBlock(country, ip, ua);
    if (!countryCheck.allowed) {
      rateLimiter.trackCountryBlock(country, limitTag, ip, asn, asnOrg);
      if (countryCheck.hard) {
        return res.status(444).end();
      }
      res.set("Retry-After", String(countryCheck.retryAfter));
      return res.status(429).send("Too Many Requests");
    }

    if (limitType) {
      const check = rateLimiter.checkRateLimit(ip, limitType, ua, country);
      if (!check.allowed) {
        rateLimiter.trackCountryBlock(country, limitTag, ip, asn, asnOrg);
        res.set("Retry-After", String(check.retryAfter));
        return res.status(429).send("Too Many Requests");
      }
    }

    const globalCheck = rateLimiter.checkRateLimit(ip, "global", ua, country);
    if (!globalCheck.allowed) {
      rateLimiter.trackCountryBlock(country, limitTag, ip, asn, asnOrg);
      res.set("Retry-After", String(globalCheck.retryAfter));
      return res.status(429).send("Too Many Requests");
    }

    const isLocalhostInDev =
      process.env.NODE_ENV !== "production" &&
      (ip === "127.0.0.1" || ip === "::1" || ip === "::ffff:127.0.0.1");
    if (!limitType && !isLocalhostInDev) {
      const subnetCheck = rateLimiter.checkSubnetRateLimit(ip, ua, country);
      if (!subnetCheck.allowed) {
        rateLimiter.trackCountryBlock(country, limitTag, ip, asn, asnOrg);
        res.set("Retry-After", String(subnetCheck.retryAfter));
        return res.status(429).send("Too Many Requests");
      }
    }

    req._ip = ip;
    req._country = country;
    req._asn = asn;
    req._asnOrg = asnOrg;
    req._limitType = limitType;

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
