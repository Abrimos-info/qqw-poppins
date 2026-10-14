# Pendiente: Google Consent Mode para regiones con mucho bot (alineado con sociedad-web-front)

> Resuelto el 2026-10-14: el bloque se porto a `views/layout.hbs` junto con el banner, ver `docs/2026-10-14-paso-a-subdominio-sociedad.md`.

## Contexto de la sesion

Durante la migracion de `quienesquien.wiki` a dominio propio (ver `abrimos-infra/docs/2026-07-10-incidente-qqw-poppins-502.md` para el incidente completo), se investigo un patron de scraping/botnet en los logs de `qqw-poppins`: miles de requests, cada uno desde una IP distinta, con User-Agents viejos/al azar (Firefox 3.6, Opera 8/9, IE 5/6/7/9), clasificados como `A=NON` (no bot) por el UA-sniffer.

Se encontro que el pais mostrado en los logs era `DE` para absolutamente todas las requests, sin importar que las IPs fueran de rangos claramente distintos -- eso llevo a descubrir un bug real: `nginx.conf` tenia `real_ip_header CF-Connecting-IP;` (resabio de la epoca de Cloudflare), pero el sitio esta detras de **Deflect**, que manda la IP real en `X-Deflect-Client-IP`, no en `CF-Connecting-IP`. Como resultado, `$geoip2_country_code` se calculaba sobre la IP del edge de Deflect, no del visitante real -- el soft-block por pais del rate limiter (`CN`, `HK`, `NL`, `FR`, `IE`, `BD`, `VN`, `IN`) nunca podia aplicarse correctamente para trafico deflectado.

**Fix ya aplicado** (2026-07-11, directo en el servidor + repo `abrimos-infra`): `real_ip_header X-Deflect-Client-IP;`. Verificado con logs reales: los paises ahora varian correctamente por IP, y el soft-block de `CN` ya esta disparando (`Blocked country:CN:39.101.92.193 | Rule: 5 reqs/300s`).

## El pendiente puntual de este doc

Revisando `sociedad-web-front/templates/head.pug` (que tiene el soft-block de pais para el rate limiter, y ademas un mecanismo separado para las *stats* de Google Analytics) se encontro que **`qqw-poppins` no tiene el equivalente**:

`sociedad-web-front/templates/head.pug:134-167` configura **Google Consent Mode v2** (`gtag('consent','default', ...)`) que deniega `analytics_storage` (y todos los `ad_*`) por defecto para:
- Las regiones EEA/UK/CH (requisito legal GDPR/DMA): `AT, BE, BG, CY, CZ, DE, DK, EE, ES, FI, FR, GB, GR, HR, HU, IE, IT, LT, LU, LV, MT, NL, PL, PT, RO, SE, SI, SK, CH, NO, IS, LI`
- Y explicitamente `SG, CN, IN, HK` -- comentario en el codigo: "deny analytics for high-bot regions" (las mismas regiones de alto trafico bot que el rate limiter tambien soft-bloquea).

Esto mantiene las estadisticas de Google Analytics de `sociedad-web-front` limpias de ruido de bots/trafico no humano de esas regiones. `qqw-poppins/views/layout.hbs:152-160` carga `gtag.js` (ID `G-N8DE0W26FL`) **sin ningun `gtag('consent', ...)` previo** -- sin denegar nada, sin distinguir region. Las stats de GA de `quienesquien.wiki` probablemente tienen el mismo ruido de bots que ya se veia en los logs del rate limiter, sin filtrar.

## Fix propuesto (pendiente de aplicar)

Copiar el mismo bloque de `head.pug` (adaptado a Handlebars) al inicio del `<head>` de `qqw-poppins/views/layout.hbs`, usando el GA ID propio de qqw (`G-N8DE0W26FL`) en vez de tocar el resto.

**Por que quedo pendiente sin aplicar en esta sesion:** el clasificador automatico de seguridad de la herramienta bloqueo la edicion al detectar el comentario "Tags will load regardless of consent and adjust behavior automatically" como potencialmente riesgoso (interpretandolo como un intento de saltarse el consentimiento del usuario). Aclaracion: ese comportamiento es como funciona **Google Consent Mode v2** por diseno -- los tags de Google siempre cargan, pero ajustan su comportamiento (modelado estadistico, no tracking real) segun la senal de consentimiento recibida. Es el mecanismo estandar de Google para sitios con banner de cookies, y es exactamente lo que ya esta en produccion en `sociedad-web-front`. El codigo a copiar no es una invencion, es literalmente el contenido existente de `head.pug:135-163`.

**Accion pendiente:** confirmar explicitamente con Martin y aplicar el bloque de consentimiento en `layout.hbs`.
