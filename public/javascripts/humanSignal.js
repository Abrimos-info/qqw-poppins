/*
 * Copia de sociedad-web-front/static/humanSignal.js (2026-10-15). En qqw va inline en layout.hbs
 * (helper human_signal_js) y solo se usa el gate: la sonda manda a /api/track, que qqw no tiene.
 *
 * Señal de interacción humana: sonda de medición (paso 1) y gate de adsbygoogle.js (paso 2, apagado
 * salvo ADS_INTERACTION_GATE=true). Va inline en head.pug en cada página con anuncios, por eso los
 * comentarios son cortos. Detalle y fuentes: docs/2026-09-28-anuncios-por-interaccion-humana.md
 * Sin scroll como disparador: window.scrollTo() de un bot también produce un scroll confiable.
 * La primera interacción real queda marcada en sessionStorage (solo un "1", sin identificador): en las
 * páginas siguientes de la misma pestaña el gate carga los anuncios sin esperar.
 * La sonda reporta una muestra de las cargas (sampleRate, se decide una vez por carga) y al ocultarse la
 * página manda el CLS con la definición de Web Vitals, más la parte posterior a la primera interacción,
 * y en qué posición quedó el anchor de AdSense.
 * En pantallas de menos de 768 px el gate carga de entrada salvo gateMobile: ahí casi no hay bots y esperar
 * la interacción hacía que los anuncios se insertaran con la persona leyendo (cola de CLS, 2026-10-02).
 */
(function (root) {
  var HUMAN_EVENTS = ["mousemove", "wheel", "touchstart", "pointerdown", "keydown"];

  function now(win) {
    return win.performance && typeof win.performance.now === "function" ? win.performance.now() : 0;
  }

  function isAutomated(nav) {
    return !!nav && nav.webdriver === true;
  }

  var SESSION_KEY = "hs_human";
  function sessionHuman(win) {
    try { return !!win.sessionStorage && win.sessionStorage.getItem(SESSION_KEY) === "1"; } catch (e) { return false; }
  }
  function rememberHuman(win) {
    try { if (win.sessionStorage) win.sessionStorage.setItem(SESSION_KEY, "1"); } catch (e) {}
  }

  function onFirstHumanInteraction(win, cb) {
    var done = false;
    function handler(e) {
      if (done || !e || e.isTrusted !== true) return;
      done = true;
      for (var i = 0; i < HUMAN_EVENTS.length; i++) win.removeEventListener(HUMAN_EVENTS[i], handler, true);
      rememberHuman(win);
      cb({ type: e.type, ms: Math.round(now(win)) });
    }
    for (var i = 0; i < HUMAN_EVENTS.length; i++) {
      win.addEventListener(HUMAN_EVENTS[i], handler, { capture: true, passive: true });
    }
  }

  function transmit(win, payload) {
    var body = JSON.stringify(payload);
    var nav = win.navigator;
    try {
      if (nav && typeof nav.sendBeacon === "function" && win.Blob &&
          nav.sendBeacon("/api/track", new win.Blob([body], { type: "application/json" }))) return;
    } catch (e) {}
    try {
      win.fetch("/api/track", {
        method: "POST", headers: { "Content-Type": "application/json" },
        credentials: "same-origin", body: body, keepalive: true
      });
    } catch (e) {}
  }

  // CLS como Web Vitals: ventanas de movimientos separados por menos de 1 s y de hasta 5 s, gana la peor.
  // Sin los movimientos dentro de los 500 ms de una entrada (hadRecentInput).
  function clsOf(entries) {
    var best = 0, cur = 0, first = 0, last = 0;
    for (var i = 0; i < entries.length; i++) {
      var e = entries[i];
      if (cur && e.startTime - last < 1000 && e.startTime - first < 5000) { cur += e.value; last = e.startTime; }
      else { cur = e.value; first = last = e.startTime; }
      if (cur > best) best = cur;
    }
    return Math.round(best * 10000) / 10000;
  }

  function observeLayoutShifts(win) {
    var shifts = [];
    var PO = win.PerformanceObserver;
    // Safari, iOS y Firefox no implementan layout-shift: observe() no falla y el CLS salía 0. Sin
    // soporte no se mide y los campos no van, como en CrUX, que es solo Chrome.
    if (typeof PO !== "function" || !PO.supportedEntryTypes || PO.supportedEntryTypes.indexOf("layout-shift") < 0) return null;
    try {
      new PO(function (list) {
        var es = list.getEntries();
        for (var i = 0; i < es.length; i++) if (!es[i].hadRecentInput) shifts.push({ startTime: es[i].startTime, value: es[i].value });
      }).observe({ type: "layout-shift", buffered: true });
    } catch (e) { return null; }
    return shifts;
  }

  // Mismos campos que track() de behavior.js, para cruzar con page_view por resolución y país.
  function payloadFor(win, action, extra) {
    var loc = win.location || {};
    var scr = win.screen || {};
    var p = {
      event: "interaction_probe", location: "window", block: null, alternative: null, action: action,
      sourceid: "sociedad-web-front", page: loc.pathname, url: loc.href, title: win.document.title,
      user_agent: win.navigator && win.navigator.userAgent, referrer: win.document.referrer,
      screen_resolution: scr.width + "x" + scr.height, viewport: win.innerWidth + "x" + win.innerHeight,
      timestamp: new Date().toISOString(), lang: win.lang || "unknown", country: win.country || "unknown",
      user_tag: win.userTag || null, probe_version: 7,
      probe_webdriver: isAutomated(win.navigator), probe_gate: !!win.__adsGate,
      probe_gate_trigger: win.__adsGate ? (win.__adsGate.trigger || (win.__adsGate.blocked ? "blocked" : "waiting")) : null
    };
    for (var k in extra) if (Object.prototype.hasOwnProperty.call(extra, k)) p[k] = extra[k];
    return p;
  }

  // TTFB de campo, como web-vitals: responseStart de Navigation Timing menos activationStart (prerender).
  // probe_ttfb_wait es lo que se esperó después de mandar la request (edge más origin) y
  // probe_ttfb_conn es DNS, TCP y TLS. Con el HTML en max-age de 10 horas, una carga desde la caché del
  // navegador da casi 0: probe_ttfb_cache "browser" la separa. Medido el 2026-10-13 desde México, con
  // Cloudflare el TTFB baja con caché y sube sin ella (docs/2026-10-13-impacto-cloudflare.md).
  function navTiming(win) {
    try {
      var perf = win.performance;
      var e = perf && typeof perf.getEntriesByType === "function" ? perf.getEntriesByType("navigation")[0] : null;
      if (!e || !(e.responseStart > 0)) return null;
      var act = e.activationStart > 0 ? e.activationStart : 0;
      var out = { probe_ttfb: Math.max(0, Math.round(e.responseStart - act)), probe_nav_type: e.type || null };
      if (e.requestStart > 0) out.probe_ttfb_wait = Math.max(0, Math.round(e.responseStart - e.requestStart));
      if (e.connectEnd >= e.domainLookupStart && e.domainLookupStart >= 0) out.probe_ttfb_conn = Math.round(e.connectEnd - e.domainLookupStart);
      if (typeof e.transferSize === "number") out.probe_ttfb_cache = e.transferSize === 0 ? "browser" : "network";
      return out;
    } catch (err) { return null; }
  }

  function startInteractionProbe(win, opts) {
    if (win.__interactionProbe) return win.__interactionProbe;
    opts = opts || {};
    var rate = typeof opts.sampleRate === "number" ? opts.sampleRate : 1;
    var rand = typeof opts.random === "function" ? opts.random : Math.random;
    var state = win.__interactionProbe = {
      interacted: false, exitSent: false, interactionMs: null, id: Math.random().toString(36).slice(2, 12),
      sessionHuman: sessionHuman(win), sampled: rand() < rate
    };
    var shifts = state.sampled ? observeLayoutShifts(win) : null;
    // Mismo filtro que track(): lo que no manda page_view tampoco manda esto.
    function skip() { return !state.sampled || win.userTag === "A=BOT" || win.userTag === "A=CRW"; }
    function send(action, extra) {
      extra.probe_id = state.id;
      extra.probe_session_human = state.sessionHuman;
      extra.probe_sample_rate = rate;
      transmit(win, payloadFor(win, action, extra));
    }

    onFirstHumanInteraction(win, function (sig) {
      state.interacted = true;
      state.interactionMs = sig.ms;
      if (skip()) return;
      send("first_interaction", { probe_type: sig.type, probe_ms: sig.ms, probe_after_exit: state.exitSent });
    });

    function onExit() {
      if (state.exitSent) return;
      state.exitSent = true;
      if (skip()) return;
      var extra = { dwell_ms: Math.round(now(win)), probe_interacted: state.interacted, probe_ms: state.interactionMs };
      if (shifts) {
        var t = state.interactionMs;
        extra.cls = clsOf(shifts);
        extra.cls_after_interaction = t === null ? 0 : clsOf(shifts.filter(function (x) { return x.startTime >= t; }));
        extra.cls_shifts = shifts.length;
      }
      var nt = navTiming(win);
      if (nt) for (var nk in nt) if (Object.prototype.hasOwnProperty.call(nt, nk)) extra[nk] = nt[nk];
      extra.probe_anchor = anchorPosition(win);
      extra.probe_anchor_fixes = win.__anchorNoPush ? win.__anchorNoPush.corrections : null;
      send("page_exit", extra);
    }
    win.addEventListener("pagehide", onExit, true);
    win.document.addEventListener("visibilitychange", function () {
      if (win.document.visibilityState === "hidden") onExit();
    }, true);
    return state;
  }

  // Anchor de AdSense: el ins con data-anchor-status. Arriba si está fijo con top 0.
  function findAnchor(win) {
    var doc = win.document;
    var els = doc && typeof doc.querySelectorAll === "function" ? doc.querySelectorAll("ins[data-anchor-status]") : [];
    for (var i = 0; i < els.length; i++) {
      var cs = win.getComputedStyle(els[i]);
      if (cs.position === "fixed") return { el: els[i], top: cs.top === "0px" };
    }
    return null;
  }

  function anchorPosition(win) {
    try {
      var a = findAnchor(win);
      if (!a) return null;
      return (a.top ? "top" : "bottom") + ":" + (a.el.getAttribute("data-anchor-status") || "");
    } catch (e) { return null; }
  }

  // Con el anchor arriba, Google le pone padding-top al body del alto del anchor y empuja la página
  // (CLS de 0,16 a 0,54 medido el 2026-10-02). Esto borra ese padding y el anchor se superpone, como
  // el de abajo. Solo en móvil y solo con ADS_ANCHOR_NO_PUSH=true. Tarea 86e3jc0tb.
  function neutralizeTopAnchorPush(win, opts) {
    opts = opts || {};
    var max = opts.maxCorrections || 50;
    var state = win.__anchorNoPush = { corrections: 0, active: false };
    var scr = win.screen || {};
    if (!(typeof scr.width === "number" && scr.width > 0 && scr.width < 768)) return state;
    if (typeof win.MutationObserver !== "function") return state;
    function fix() {
      var body = win.document.body;
      if (!body || !body.style || !body.style.paddingTop || state.corrections >= max) return;
      var a = findAnchor(win);
      if (!a || !a.top) return;
      body.style.removeProperty("padding-top");
      state.corrections++;
    }
    function start() {
      if (state.active || !win.document.body) return;
      state.active = true;
      var mo = new win.MutationObserver(fix);
      // Un solo observe por nodo: un segundo observe sobre body reemplaza las opciones del primero.
      // El anchor se agrega como hijo de html o de body, a veces después del padding.
      mo.observe(win.document.body, { attributes: true, attributeFilter: ["style"], childList: true });
      mo.observe(win.document.documentElement, { childList: true });
      fix();
    }
    if (win.document.body) start();
    else win.document.addEventListener("DOMContentLoaded", start);
    return state;
  }

  // Valores de data-overlays documentados por AdSense (support.google.com/adsense/answer/7478225):
  // "bottom" saca el anchor de arriba, "collapsed-bottom" además apaga el anchor que se expande.
  var MOBILE_OVERLAYS = ["bottom", "collapsed-bottom"];

  function gateAdsLoader(win, opts) {
    var gate = win.__adsGate = { injected: false, blocked: false, trigger: null, listeners: [] };
    if (isAutomated(win.navigator)) {
      gate.blocked = true;
      return gate;
    }
    var scr = win.screen || {};
    var mobile = typeof scr.width === "number" && scr.width > 0 && scr.width < 768;
    function inject(trigger) {
      var s = win.document.createElement("script");
      s.async = true;
      s.src = opts.src;
      s.crossOrigin = "anonymous";
      // Anchor solo abajo en móvil, sin empujar la página (CLS). Se decide acá y no en el HTML para
      // que el HTML siga siendo igual para todos y no rompa la caché de Deflect. Tarea 86e3jc0tb.
      if (mobile && MOBILE_OVERLAYS.indexOf(opts.mobileOverlays) >= 0) s.setAttribute("data-overlays", opts.mobileOverlays);
      win.document.head.appendChild(s);
      gate.injected = true;
      gate.trigger = trigger;
      var pending = gate.listeners.splice(0);
      for (var i = 0; i < pending.length; i++) { try { pending[i](); } catch (e) {} }
    }
    if (mobile && !opts.gateMobile) inject("mobile");
    // Ya interactuó en otra página de esta pestaña: no hace falta esperar.
    else if (sessionHuman(win)) inject("session");
    else onFirstHumanInteraction(win, function (sig) { inject(sig.type); });
    return gate;
  }

  var api = {
    HUMAN_EVENTS: HUMAN_EVENTS, isAutomated: isAutomated, onFirstHumanInteraction: onFirstHumanInteraction,
    startInteractionProbe: startInteractionProbe, gateAdsLoader: gateAdsLoader, clsOf: clsOf,
    neutralizeTopAnchorPush: neutralizeTopAnchorPush, anchorPosition: anchorPosition
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.HumanSignal = api;
})(this);
