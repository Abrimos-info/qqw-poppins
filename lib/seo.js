"use strict";

// Canonical URL, hreflang, robots and host redirects for every page of the app.
// The same app serves four sites (see the server_name in the nginx vhost):
// quienesquienwiki.sociedad.info and three microsites. Each page belongs to one
// host and one canonical URL:
// - a page is canonical on the host of the site it belongs to; any other of the
//   four hosts answers 301 to it (before, every page answered 200 on every host)
// - the path uses the slugs of its language (/en/companies, not /en/empresas),
//   without trailing slash; other variants answer 301
// - search pages keep only their filters with a value, in a fixed order, and the
//   page number if it is above 1; everything else (subject, sort, size, empty
//   filters, tracking) is dropped from the canonical
// - free text searches are noindex,follow (internal search results)

const constants = require("./const");

const MAIN_HOST = "quienesquienwiki.sociedad.info";
const SITE_HOSTS = [
  MAIN_HOST,
  "todosloscontratos.sociedad.info",
  "mujeresenlabolsa.sociedad.info",
  "saluddineroycorrupcion.sociedad.info",
];

// Templates of the microsites, by host. Everything else belongs to the main site.
const MICROSITE_TEMPLATES = {
  "todos-los-contratos": "todosloscontratos.sociedad.info",
  "mujeres-en-la-bolsa": "mujeresenlabolsa.sociedad.info",
  "mujeres-en-la-bolsa-english": "mujeresenlabolsa.sociedad.info",
  "graph1": "mujeresenlabolsa.sociedad.info",
  "graph2": "mujeresenlabolsa.sociedad.info",
  "salud": "saluddineroycorrupcion.sociedad.info",
  "salud-estados": "saluddineroycorrupcion.sociedad.info",
};

// Microsite pages with content in a single language: canonical in that language,
// no hreflang. The Mujeres page has a Spanish and an English version with
// different paths, paired by hand.
const SINGLE_LANGUAGE = {
  "todos-los-contratos": "es",
  "salud": "es",
  "salud-estados": "es",
  "mujeres-en-la-bolsa": "es",
  "mujeres-en-la-bolsa-english": "en",
  "graph1": "es",
  "graph2": "en",
};
const PAIRED = {
  "mujeres-en-la-bolsa": { es: "/es/mujeres-en-la-bolsa", en: "/en/women-in-the-stock-exchange" },
  "mujeres-en-la-bolsa-english": { es: "/es/mujeres-en-la-bolsa", en: "/en/women-in-the-stock-exchange" },
};
// Embedded in iframes, never a search result
const NOINDEX_TEMPLATES = ["graph1", "graph2"];

// Search filters that change the results, in canonical order. Ranges come as
// <name>-min and <name>-max.
const SEARCH_PARAMS = [
  "collection", "classification", "tipo-entidad", "subtipo-entidad",
  "tipo-institucion", "subtipo-institucion", "tipo-adquisicion",
  "proveedor", "dependencia", "responsable", "financiador", "entidad",
  "producto", "producto-indicacion", "fuente",
  "pais", "pais-c", "estado", "estado-c", "ciudad", "ciudad-c",
  "fecha-inicio", "name", "titulo", "identifier", "contrato-id",
];
const RANGE_PARAMS = ["importe-proveedor", "importe-comprador", "importe-contrato", "cantidad-proveedor", "cantidad-comprador"];
const FREE_TEXT_PARAMS = ["name", "titulo", "identifier", "contrato-id"];

function routeRegex(pattern) {
  const escaped = pattern.split("/").map((part) =>
    part.startsWith(":") ? "([^/]+)" : part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("/");
  return new RegExp("^" + escaped + "$");
}

const ROUTES = constants.qqw_routes
  .filter((route) => !route.method)
  .map((route) => ({
    route: route,
    template: route.view === "staticPage" ? route.params[0] : null,
    es: routeRegex(route.es),
    en: routeRegex(route.en),
  }));

function fillRoute(pattern, values) {
  let i = 0;
  return pattern.split("/").map((part) => part.startsWith(":") ? encodeURIComponent(decodeURIComponent(values[i++])) : part).join("/");
}

// rest: path after /<lang>/, without trailing slash. Returns the route and its params.
function matchRoute(rest) {
  for (const r of ROUTES) {
    for (const lang of ["es", "en"]) {
      const m = r[lang].exec(rest);
      if (m) return { r: r, values: m.slice(1) };
    }
  }
  return null;
}

function searchQuery(query) {
  const pairs = [];
  const keys = [];
  for (const name of SEARCH_PARAMS) keys.push(name);
  for (const name of RANGE_PARAMS) keys.push(name + "-min", name + "-max");
  for (const key of keys) {
    let value = query[key];
    if (Array.isArray(value)) value = value[0];
    if (typeof value === "string" && value.trim() !== "") pairs.push([key, value.trim()]);
  }
  const page = parseInt(query.page, 10);
  if (page > 1) pairs.push(["page", String(page)]);
  return pairs.length ? "?" + new URLSearchParams(pairs).toString() : "";
}

function hostOf(req) {
  return (req.headers["x-forwarded-host"] || req.headers.host || "").split(":")[0].toLowerCase();
}

// Middleware. Sets res.locals.seo = { canonical, alternates, noindex } and
// res.locals.site_origin, and answers 301 for host, slug and trailing slash variants.
function middleware(extraHosts) {
  const knownHosts = SITE_HOSTS.concat(extraHosts || []);
  return function seoMiddleware(req, res, next) {
    const host = hostOf(req);
    const isSiteHost = SITE_HOSTS.includes(host);
    const origin = (h) => "https://" + (isSiteHost || !knownHosts.includes(host) ? h : host);
    res.locals.site_origin = "https://" + (knownHosts.includes(host) ? host : MAIN_HOST);
    res.locals.seo = {};

    if (req.method !== "GET" && req.method !== "HEAD") return next();

    const pathMatch = /^\/(es|en)(\/.*)?$/.exec(req.path);
    if (!pathMatch) return next();
    const lang = pathMatch[1];
    const rest = (pathMatch[2] || "/").replace(/^\/+|\/+$/g, "");

    // /es and /en: the home of the site of this host
    if (rest === "") {
      const site = Object.keys(constants.qqw_sites).find((name) => host.split(".")[0] === name);
      const target = site ? constants.qqw_sites[site][lang] : "/" + (lang === "es" ? "inicio" : "home");
      return res.redirect(301, "/" + lang + target);
    }

    const match = matchRoute(rest);
    if (!match) return next();
    const { r, values } = match;
    const route = r.route;
    const siteHost = MICROSITE_TEMPLATES[r.template] || MAIN_HOST;
    const singleLang = SINGLE_LANGUAGE[r.template];
    const canonicalLang = singleLang || lang;
    const isSearch = route.view === "searchPage2020";

    const query = isSearch ? searchQuery(req.query) : "";
    const pathFor = (l) => "/" + l + "/" + fillRoute(route[l], values);
    const canonicalPath = PAIRED[r.template] ? PAIRED[r.template][canonicalLang] : pathFor(canonicalLang);

    // 301 for another host of the four, or a slug or trailing slash variant.
    // Only on the real hosts: beta and local serve every site on one host.
    if (isSiteHost) {
      const currentPath = req.path;
      const wantedPath = singleLang ? currentPath.replace(/\/+$/, "") : pathFor(lang);
      const qs = req.originalUrl.includes("?") ? req.originalUrl.slice(req.originalUrl.indexOf("?")) : "";
      if (host !== siteHost) {
        return res.redirect(301, "https://" + siteHost + (singleLang ? canonicalPath : wantedPath) + qs);
      }
      if (decodeURIComponent(currentPath) !== decodeURIComponent(wantedPath) && !singleLang) {
        return res.redirect(301, wantedPath + qs);
      }
      if (singleLang && currentPath !== wantedPath) {
        return res.redirect(301, wantedPath + qs);
      }
    }

    const base = origin(siteHost);
    const seo = res.locals.seo;
    seo.canonical = base + canonicalPath + query;
    if (PAIRED[r.template]) {
      seo.alternates = [
        { lang: "es", href: base + PAIRED[r.template].es },
        { lang: "en", href: base + PAIRED[r.template].en },
        { lang: "x-default", href: base + PAIRED[r.template].es },
      ];
    } else if (!singleLang) {
      seo.alternates = [
        { lang: "es", href: base + pathFor("es") + query },
        { lang: "en", href: base + pathFor("en") + query },
        { lang: "x-default", href: base + pathFor("es") + query },
      ];
    }
    if (NOINDEX_TEMPLATES.includes(r.template)) seo.noindex = true;
    if (isSearch && FREE_TEXT_PARAMS.some((p) => typeof req.query[p] === "string" && req.query[p].trim() !== "")) {
      seo.noindex = true;
    }
    next();
  };
}

// JSON-LD (schema.org) for an entity page: the entity and its breadcrumb.
// Contracts and products only get the breadcrumb: Product would ask Google for
// offers and reviews that these pages don't have.
const ENTITY_TYPES = {
  persons: "Person",
  companies: "Organization",
  institutions: "GovernmentOrganization",
  areas: "Place",
};
const SECTION_NAMES = {
  persons: { es: "Personas", en: "People" },
  companies: { es: "Empresas", en: "Companies" },
  institutions: { es: "Instituciones públicas", en: "Public institutions" },
  areas: { es: "Regiones", en: "Areas" },
  contracts: { es: "Contratos", en: "Contracts" },
  record: { es: "Expedientes", en: "Records" },
  products: { es: "Productos", en: "Products" },
};
const SEARCH_COLLECTION = { record: "contracts" };

function entityJsonLd(collection, entity, seo, lang) {
  if (!seo || !seo.canonical || !entity) return null;
  const name = entity.name || entity.title || (entity.contracts && entity.contracts.title) ||
    (entity.records && entity.records.compiledRelease && entity.records.compiledRelease.contracts && entity.records.compiledRelease.contracts.title);
  if (!name || typeof name !== "string") return null;
  const origin = seo.canonical.replace(/^(https:\/\/[^/]+).*$/, "$1");
  const graph = [];
  const section = SECTION_NAMES[collection];
  graph.push({
    "@type": "BreadcrumbList",
    "itemListElement": [
      { "@type": "ListItem", "position": 1, "name": "QuiénEsQuién.Wiki", "item": origin + "/" + lang + "/" + (lang === "es" ? "inicio" : "home") },
      { "@type": "ListItem", "position": 2, "name": section ? section[lang] : collection, "item": origin + "/" + lang + "/" + (lang === "es" ? "buscador" : "search") + "?collection=" + (SEARCH_COLLECTION[collection] || collection) },
      { "@type": "ListItem", "position": 3, "name": name, "item": seo.canonical },
    ],
  });
  if (ENTITY_TYPES[collection]) {
    graph.push({ "@type": ENTITY_TYPES[collection], "name": name, "url": seo.canonical });
  }
  return { "@context": "https://schema.org", "@graph": graph };
}

function homeJsonLd(seo) {
  if (!seo || !seo.canonical) return null;
  const origin = seo.canonical.replace(/^(https:\/\/[^/]+).*$/, "$1");
  return {
    "@context": "https://schema.org",
    "@graph": [
      { "@type": "WebSite", "name": "QuiénEsQuién.Wiki", "url": origin + "/" },
      { "@type": "Organization", "name": "QuiénEsQuién.Wiki", "url": origin + "/", "logo": origin + "/images/qqw-card.png" },
    ],
  };
}

// Safe inside <script>: no "</script>" or "<!--" can come out of the data
function serialize(jsonld) {
  return jsonld ? JSON.stringify(jsonld).replace(/</g, "\\u003c") : "";
}

module.exports = { middleware, entityJsonLd, homeJsonLd, serialize, searchQuery, SITE_HOSTS, MAIN_HOST };
