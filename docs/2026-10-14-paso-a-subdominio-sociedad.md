# Paso de quienesquien.wiki a quienesquienwiki.sociedad.info
2026-10-14

## Que se hizo

- Desde 2026-10-14, el sitio se sirve como `quienesquienwiki.sociedad.info`, para poder servir anuncios en el dominio de sociedad.info.
- `quienesquien.wiki` y `www.quienesquien.wiki` redirigen 301 a la misma ruta en el subdominio.
- El cambio esta en nginx: `abrimos-infra/nginx/sites-enabled/qqw.sociedad.info`, commit `a4432f8` de abrimos-infra.
- El app no necesito cambios para servir en el subdominio: `redirectToSite` (`lib/lib.js`) ya trata `quienesquienwiki` como sitio principal y redirige `/` a `/es/inicio` en el mismo host.
- El subdominio pasa por Cloudflare, en la zona de sociedad.info. Tiene cache de HTML que respeta el `Cache-Control` del origin (`public,max-age=600`), en todos los idiomas, porque el idioma va en la URL.
- AdSense carga en el subdominio (verificado: `pagead2.googlesyndication` en `/es/inicio`).

## Pendientes en este repo

1. **Canonical. En prod desde `d268ffa`.** Era `content` en vez de `href` (Google lo ignoraba) y apuntaba al dominio viejo. Ahora es `href="{{canonical_url}}"`, que arma `siteOriginMiddleware` en `app.js`: el host del request si es uno de los cuatro sitios del vhost (`quienesquienwiki`, `todosloscontratos`, `mujeresenlabolsa`, `saluddineroycorrupcion` `.sociedad.info`), si no el principal. Sin query string. `og:url` y `og:image` usan el mismo origin.
2. **AdPlus. Apagado (decision de Martin, 2026-10-14).** `ADPLUS_ENABLED=false` en el `.env` de produccion, backup en `/root/qqw-poppins.env.bak-20261014`. `ADPLUS_WEBSITE` deja de importar.
3. **Links absolutos al dominio viejo. En prod desde `d268ffa`.** `www.quienesquien.wiki` y `quienesquien.wiki` pasan a `quienesquienwiki.sociedad.info` en `lib/const.js`, traducciones, `package.json` y vistas. `mujeresenlabolsa.quienesquien.wiki` y `saluddineroycorrupcion.quienesquien.wiki`, que ya no resuelven, pasan a sus subdominios de sociedad.info. Quedan los `info@quienesquien.wiki` del aviso de privacidad (correo, no link) y los hosts del punto 6.
4. **Sitemap y robots.**
   - `robots.txt` (sin trackear, solo en el server): corregido el 2026-10-14 a `Sitemap: https://quienesquienwiki.sociedad.info/sitemap/sitemap.xml`. Antes apuntaba a `quienesquien.wiki/sitemap.xml`, que daba 404. Backup en `/root/qqw-robots.txt.bak-20261014`.
   - `public/sitemap/` es un checkout aparte de `ProjectPODER/qqw-generated-assets` (ultimo commit 2023-05-30, `lastmod` 2022-11-07). Son 16 archivos y 568.352 URLs, todas en `https://www.quienesquien.wiki/...`, que ahora son 301. Una muestra de 23 URLs en el host nuevo dio 200 en las fichas, 302 en `/` y 302 a `sociedad.info/contact` en `/es/contacto`.
   - Corregido el 2026-10-14, en el mismo checkout para que se vea en `git diff`: host nuevo en los 16 archivos, y de `sitemap_static.xml` salen `/` (302), `/es/contacto` (302 a sociedad.info) y los 6 `/es/buscador/?collection=` (el canonical los colapsa). Quedan 568.344 URLs. `lastmod` 2022-11-07 se deja porque los datos son de esa fecha, y no se regenera porque no hay datos nuevos. Backup en `/root/qqw-sitemap.bak-20261014.tgz`.
5. **API publica apagada (decision de Martin, 2026-10-14).** `api.quienesquien.wiki` no tiene DNS desde la migracion a Deflect de junio, su vhost esta deshabilitado y el cert vencio el 2026-07-11. Queda apagada. Hay que sacar o cambiar la pagina `/apis` (`views/apis.hbs`), que linkea a `api.quienesquien.wiki/v3/docs/` y a `kibana.quienesquien.wiki`, y el link a `status.quienesquien.wiki` de `views/error.hbs`. El autocomplete del sitio no depende de la API publica: usa `/api/v3/autocomplete` en el mismo host, proxeado por nginx a qqwapi-elastic.
6. **Links a otros servicios con el dominio viejo.** `views/apis.hbs` y `views/error.hbs` apuntan a `status.quienesquien.wiki`, `api.quienesquien.wiki` y `kibana.quienesquien.wiki`. `views/salud-estados.hbs` apunta a `publico-simona.quienesquien.wiki`. Ninguno existe hoy en DNS. Segun el export de Gandi del 2026-06-04 (`abrimos-infra/zonefiles/quienesquien.wiki-ascii.zone` y su historia en git):
   - `status` y `kibana` eran CNAME a `webredir.gandi.net`, o sea redirects web de Gandi. El destino esta en la config de redireccion web de Gandi, no en el DNS.
   - `simona`, `publico-simona` y `grafana` apuntaban a un droplet de DigitalOcean (167.172.8.174) que ya devolvia 404 en junio. Se borraron en la limpieza del 2026-06-04.
   - Los links estan rotos: hay que sacarlos o reemplazarlos.

## Search Console

No hace falta hacer nada. La herramienta Change of Address es opcional: segun la ayuda de Google, se usa "after you've moved and redirected your site", y lo indispensable es el 301 desde el dominio viejo. Ademas, la propiedad `sc-domain:sociedad.info` ya incluye el subdominio, asi que el trafico se ve ahi sin configurar nada. Si se quiere acelerar la consolidacion de senales, Martin puede usarla siendo owner de las dos propiedades (https://support.google.com/webmasters/answer/9370220).

## Consentimiento y AdSense

- AdSense > Centro de politicas marco `www.quienesquien.wiki` con "Personalizacion de anuncios restringida, requisito de consentimiento: sin CMP" (23 k solicitudes, 2026-10-08). No es un bloqueo: la publicacion seguia al 100%. En el EEE, UK y Suiza se servian anuncios limitados.
- En el subdominio el CMP de Google ya aparece, porque el mensaje de Privacidad y mensajeria de sociedad.info cubre al subdominio. Verificado el 2026-10-14 cargando `/es/sobre-qqw` desde chocolate (IP del EEE): el DOM tiene `fc-consent-root`. Sin el proxy, no.
- Se porto el consentimiento de sociedad-web-front (en prod desde `d268ffa`). Verificado despues del deploy: desde el EEE aparece el CMP de Google y el banner propio queda oculto, fuera del EEE el banner propio se muestra.
  - Default de Consent Mode al principio del `<head>` de `views/layout.hbs`. EEE, UK, CH, SG, CN, IN y HK arrancan todo en denied. El resto del mundo arranca con analytics granted y ads denied.
  - Banner propio en `views/partials/consent-banner.hbs` para donde no aplica GDPR. Si el CMP de Google dice `gdprApplies`, no se muestra.
  - Efecto a vigilar: fuera del EEE los anuncios quedan sin personalizar hasta que la persona acepta en el banner. Es lo mismo que pasa en sociedad.

## PiTrack y la barra amarilla

- La barra ("Avisame cuando se vuelvan a actualizar los datos") no escribe en Brevo ni manda correo. Solo manda eventos `email_subscription` y `follow_up_submission` a `https://sociedad.info/track` (`public/javascripts/main.js:648-690`).
- PiTrack rechazaba esos eventos: `www.quienesquien.wiki` no esta en `PITRACK_ALLOWED_ORIGINS`. En `pitrack-error.log` hay entre 37 y 48 mil "Origin not allowed: https://www.quienesquien.wiki" por dia en los logs del 2026-09-30 al 2026-10-13. `log.jsonl` no tiene ningun `email_subscription` de `qqw-poppins`. Los correos que se dejaron en la barra se perdieron.
- `https://quienesquienwiki.sociedad.info` ya esta permitido (el preflight devuelve su origin). Siguen rechazados `mujeresenlabolsa.sociedad.info` (2550) y `todosloscontratos.sociedad.info` (191), y `saluddineroycorrupcion.sociedad.info` tampoco esta. Hay que sumarlos a `PITRACK_ALLOWED_ORIGINS` (proceso pm2 `pitrack`, ver el session log de abrimos-infra del 2026-10-14, seccion "PiTrack acepta gobernantes").
- Falta decidir a donde van esos correos: hoy quedan solo en `log.jsonl` de PiTrack.

## nginx: headers de CDN

- `location /` del vhost manda `X-Deflect-Client-IP` y `CF-Connecting-IP` vacios. El rate limiter los lee antes que `X-Real-IP`, y un request directo al origin podia elegir su IP. `$remote_addr` ya es la IP real por `real_ip_header X-Deflect-Client-IP` con `set_real_ip_from` de Deflect y Cloudflare en `nginx.conf`. Igual que gobernantes.info.
- Efecto en logs: el tag `via` del app pasa a `NGX` para todo. Antes tampoco distinguia Cloudflare de Deflect, porque la transform rule de la zona sociedad.info escribe `X-Deflect-Client-IP`.
- Cambio en `abrimos-infra/nginx/sites-enabled/qqw.sociedad.info` y en la copia `nginx/qqw.sociedad.info` de este repo, que estaba desactualizada desde marzo y ahora es igual a la del server. Falta aplicarlo en el server (backup, `nginx -t`, reload).

## Monitoreo de la migracion

Linea base: Deflect, `quienesquien.wiki`, "Last week" del 2026-10-06 al 2026-10-12, antes del cambio (captura de Martin, numeros leidos de la imagen).

- Requests: entre 3 y 4 millones por dia. IPs unicas: bajan de unas 180 mil a unas 100 mil por dia en la semana. Casi todo se sirve desde el origin, el cache de Deflect pega poco.
- Paises: Estados Unidos 10.465.976, China 2.574.130, Vietnam 1.238.617, Bangladesh 1.086.132, Brasil 827.035, Singapur 772.022, India 609.668, Reino Unido 505.014, Alemania 466.960, Mexico 402.024.
- User agents: Chrome 10.668.939, Safari 1.803.425, Chrome Mobile 1.176.524, ClaudeBot 1.139.287, Firefox 1.122.831, Amazonbot 756.736, Edge 594.213, SemrushBot 148.354, ReflectionBot 39.605, UptimeRobot 7.921. Que Chrome y Estados Unidos tengan casi el mismo numero sugiere scraping con UA de navegador desde datacenters de EEUU [hipotesis: se prueba cruzando ASN en `qqw.access.log`].
- Status: 200 16.924.135, 302 2.254.430, 429 1.564.449, 404 892.213, 206 273.643, 304 267.751, 301 116.494, 403 103.436, 400 73.938.
- Paginas: `/es/buscador` 1.317.066, `/es/licencia` 407.609, `/es/sobre-qqw` 335.739, `/es/manual` 237.667, `/es/herramientas` 235.991, `/es/privacidad` 227.621, `/es/investigaciones` 218.850, `/es/entidades-y-fuentes` 211.022, `/es/inicio` 197.512. Hay una tercera ruta con 393.527 que no se lee bien en la captura.

Que mirar despues del cambio:

- **Deflect (`quienesquien.wiki`)**: los 200 tienen que pasar a 301. El volumen total deberia seguir parecido mientras los bots sigan pidiendo el dominio viejo. Bajarlo es tarea de la regla de Deflect, no del app.
- **Cloudflare (`quienesquienwiki.sociedad.info`)**: requests, cache hit ratio de la regla de HTML y 429. Se consulta por API GraphQL con el token de Cloudflare via Infisical (`with_cf_token.py` en abrimos-infra).
- **nginx (`/var/log/nginx/qqw.access.log`)**: requests por host por hora. `quienesquien.wiki` tiene que ser solo 301.
- **AdSense**: solicitudes de `quienesquienwiki.sociedad.info` dentro de sociedad.info, y que el aviso "sin CMP" de `www.quienesquien.wiki` deje de crecer.
- **GA (`G-N8DE0W26FL`)**: despues del deploy, menos sesiones de SG, CN, IN y HK por el default denied.
- **Search Console (`sc-domain:sociedad.info`)**: impresiones del subdominio subiendo y las del dominio viejo bajando. Depende del sitemap (punto 4).

## Deploy del 2026-10-14

- Beta temporal: checkout en `/opt/scripts/qqw-poppins-beta` con el `.env` de prod, puerto 3011, proceso pm2 `qqw-poppins-beta`. Probado con curl por Host contra el node de prod (3001) y Chrome headless por tunel. Despues se borro el proceso, el directorio queda.
- Prod: `git merge --ff-only` a `d268ffa` en `/opt/scripts/qqw-poppins` y `pm2 reload qqw-poppins --update-env`.
- Artefacto conocido de probar por http con tunel: `tiza is not defined` aparece igual en prod y en beta, no en https.

