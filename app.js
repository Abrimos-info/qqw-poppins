const createError = require("http-errors");
const express = require("express");
const path = require("path");
const cookieParser = require("cookie-parser");
const morgan = require("morgan");
const cacheControl = require("express-cache-controller");
const stylus = require("stylus");
const hbs = require("express-handlebars");
const dotenv = require("dotenv");
const dotenvExpand = require("dotenv-expand");
const myEnv = dotenv.config();
dotenvExpand.expand(myEnv);
const indexRouter = require("./routes/index");
const lib = require("./lib/lib");
const app = express();
const helpers = require("./lib/helpers.js").helpers;

// Base path configuration for subfolder hosting
const BASE_PATH = process.env.BASE_PATH || "";

// Normalize base path (remove trailing slash, ensure leading slash)
function normalizeBasePath(path) {
  if (!path) return "";
  path = path.trim();
  if (path === "/") return "";
  if (!path.startsWith("/")) path = "/" + path;
  if (path.endsWith("/")) path = path.slice(0, -1);
  return path;
}

// Auto-detect base path from request URL (extract path before /es/ or /en/)
function detectBasePathFromRequest(req) {
  const originalUrl = req.originalUrl || req.url || "";
  // Match path segments before /es/ or /en/
  // Example: /quienesquienwiki/es/aliados -> /quienesquienwiki
  const match = originalUrl.match(/^(\/[^\/]+)(?:\/(?:es|en)\/)/);
  if (match && match[1] && match[1] !== "/") {
    return match[1];
  }
  return "";
}

const staticBasePath = normalizeBasePath(BASE_PATH);

// Make base path available to templates (will be updated per request if auto-detecting)
app.locals.basePath = staticBasePath;

// Middleware to detect and set basePath per request
app.use(function(req, res, next) {
  // Use static base path if set, otherwise auto-detect from request
  let detectedBasePath = staticBasePath;
  if (!detectedBasePath) {
    detectedBasePath = detectBasePathFromRequest(req);
  }
  
  // Also check req.baseUrl (set by Express when router is mounted)
  if (req.baseUrl && req.baseUrl !== "/") {
    detectedBasePath = req.baseUrl;
  }
  
  // Normalize the detected path
  detectedBasePath = normalizeBasePath(detectedBasePath);
  
  // Store in res.locals for use in templates and helpers
  res.locals.basePath = detectedBasePath;
  // Also store in req for use in route handlers
  req.detectedBasePath = detectedBasePath;
  
  console.log("Base path detection - originalUrl:", req.originalUrl, "baseUrl:", req.baseUrl, "detected:", detectedBasePath, "static:", staticBasePath);
  
  next();
});

// Trust proxy for correct handling of X-Forwarded-* headers (needed for Cloudflare/proxies)
app.set("trust proxy", true);

function initApp(appLocals) {
  // console.log("appLocals general",appLocals.general);
  // console.log("appLocals buscadores",appLocals.buscadores);
  // console.log("appLocals notas",appLocals.notas);

  // handlebars setup
  const handlebars = hbs.engine({
    extname: "hbs",
    defaultLayout: "layout",
    layoutsDir: path.join(
      __dirname,
      appLocals.general && appLocals.general.views && appLocals.general.views[0]
        ? appLocals.general.views[0].staging
        : "views",
    ),
    partialsDir: [
      //  path to your partials
      path.join(__dirname, "views/partials"),
      path.join(
        __dirname,
        appLocals.general &&
          appLocals.general.partials &&
          appLocals.general.partials[0]
          ? appLocals.general.partials[0].staging
          : "views/partials",
      ),
    ],
    helpers: helpers,
  });
  app.engine(".hbs", handlebars);

  // view engine setup
  app.set("views", path.join(__dirname, "views"));
  app.set("view engine", "hbs");

  // log only 4xx and 5xx responses to console
  app.use(
    morgan("short", {
      skip: function (req, res) {
        return (
          res.statusCode < 400 &&
          req.headers.accept &&
          req.headers.accept.indexOf("html") == -1
        );
      },
    }),
  );

  app.use(express.json());
  app.use(express.urlencoded({ extended: false }));
  app.use(cookieParser());

  console.log(
    "stylus path",
    appLocals.general &&
      appLocals.general.style_path &&
      appLocals.general.style_path[0]
      ? appLocals.general.style_path[0].staging
      : "public/stylesheets",
  );
  app.use(
    stylus.middleware({
      serve: true,
      dest:
        appLocals.general && appLocals.general.extra_static_path
          ? path.join(__dirname, appLocals.general.extra_static_path[0].staging)
          : "public",
      src: path.join(
        __dirname,
        appLocals.general &&
          appLocals.general.style_path &&
          appLocals.general.style_path[0]
          ? appLocals.general.style_path[0].staging
          : "public/stylesheets",
      ),
      force: true,
      linenos: false,
    }),
  );

  const staticOptions = {
    index: false,
    cacheControl: true,
    maxAge: 60000000,
  };

  // Mount static middleware at base path for subfolder hosting support
  const staticMountPath = basePath || "/";
  app.use(staticMountPath, express.static(path.join(__dirname, "public"), staticOptions));

  if (appLocals.general && appLocals.general.extra_static_path) {
    app.use(
      basePath + "/extra",
      express.static(
        path.join(__dirname, appLocals.general.extra_static_path[0].staging),
        staticOptions,
      ),
    );
  }

  // Bootstrap 4 and libraries - mount at base path
  app.use(
    basePath + "/jQuery",
    express.static(__dirname + "/node_modules/jquery/dist/", staticOptions),
  );
  app.use(
    basePath + "/bootstrap",
    express.static(__dirname + "/node_modules/bootstrap/dist/", staticOptions),
  );
  app.use(
    basePath + "/tiza",
    express.static(__dirname + "/node_modules/tiza", staticOptions),
  );
  app.use(
    basePath + "/datatables",
    express.static(
      __dirname + "/node_modules/datatables.net/js",
      staticOptions,
    ),
  );
  app.use(
    basePath + "/datatables-styles",
    express.static(
      __dirname + "/node_modules/datatables.net-dt/css",
      staticOptions,
    ),
  );

  app.use(
    cacheControl({
      // public: true,
      noCache: true,
    }),
  );

  // Mount router - if static base path is set, use it; otherwise mount at root and let auto-detection handle it
  // Note: When mounting at a specific path, Express sets req.baseUrl automatically
  // When mounting at root, we rely on auto-detection in middleware
  if (staticBasePath) {
    app.use(staticBasePath, indexRouter);
  } else {
    // Mount at root, but we'll detect base path per request in middleware
    app.use("/", indexRouter);
  }

  console.log("App started, server listening. Env", helpers.env());

  // catch 404 and forward to error handler
  app.use(function (req, res, next) {
    console.error("=== 404 ERROR ===");
    console.error("Request URL:", req.url);
    console.error("Request originalUrl:", req.originalUrl);
    console.error("Request baseUrl:", req.baseUrl);
    console.error("Request method:", req.method);
    console.error("Base path:", req.app.locals.basePath);
    next(createError(404));
  });

  // error handler
  app.use(function (err, req, res, next) {
    //Don't show trace for 404 errors
    if (err.message != "Not Found") {
      // set locals, only providing error in development
      res.locals.error = req.app.get("env") === "development" ? err : {};
      res.locals.message = err.message;

      console.error("/!\\ QuienEsQuien.Wiki APP Error at URL: ", req.url);
      console.error("/!\\ QuienEsQuien.Wiki APP Error: ", err);
      console.error("/!\\ Error stack: ", err.stack);
      console.error("/!\\ Request originalUrl: ", req.originalUrl);
      console.error("/!\\ Request baseUrl: ", req.baseUrl);
      console.error("/!\\ Base path: ", req.app.locals.basePath);
    }

    res.cacheControl = {
      noStore: true,
    };
    // render the error page
    res.status(err.status || 500);
    res.render("error", { error: true, current_url: req.url });
  });

  //Last resource error handler.
  app.use(function (err, req, res, next) {
    console.error("=== LAST RESOURCE ERROR HANDLER ===");
    console.error("Error:", err);
    console.error("Request URL:", req.url);
    console.error("Request originalUrl:", req.originalUrl);
    console.error("Request method:", req.method);
    console.error("Request headers:", JSON.stringify(req.headers, null, 2));
    console.error("Base path:", req.app.locals.basePath);
    console.error("Stack:", err.stack);
    res.status(404);
    res.json({
      en: "We will recover from this too. Please reload the page. If this message repeats, please let us know.",
      es: "Nos vamos a recuperar de esta. Por favor refresque la página. Si este mensaje se repite por favor infórmenos.",
    });
  });
}

lib.loadSettings(app, initApp);

module.exports = app;
