# Paso de quienesquien.wiki a quienesquienwiki.sociedad.info
2026-10-14

## Que se hizo

- Desde 2026-10-14, el sitio se sirve como `quienesquienwiki.sociedad.info`, para poder servir anuncios en el dominio de sociedad.info.
- `quienesquien.wiki` y `www.quienesquien.wiki` redirigen 301 a la misma ruta en el subdominio.
- El cambio esta en nginx: `abrimos-infra/nginx/sites-enabled/qqw.sociedad.info`, commit `a4432f8` de abrimos-infra.
- El app no necesito cambios para servir en el subdominio: `redirectToSite` (`lib/lib.js`) ya trata `quienesquienwiki` como sitio principal y redirige `/` a `/es/inicio` en el mismo host.
- El subdominio pasa por Cloudflare, en la zona de sociedad.info. Tiene cache de HTML que respeta el `Cache-Control` del origin (`public,max-age=600`), en todos los idiomas, porque el idioma va en la URL.
- AdSense carga en el subdominio (verificado: `pagead2.googlesyndication` en `/es/inicio`).


## SEO: canonical, hosts, hreflang (`c183e4e`, en prod el 2026-10-15)

Diagnostico (GSC, propiedad `sc-domain:sociedad.info`, 2026-09-15 a 2026-10-14, 500 URLs de los subsitios con impresiones; la API no da el informe de indexacion, se uso inspeccion de URLs):
- 373 de 500 URLs tenian query. 151 con `subject=...` (del link de contacto de los modales de reporte) y 79 con una docena de filtros vacios (formulario del buscador). Las inspeccionadas: "Crawled - currently not indexed". Los links de hoy ya no arrastran esos parametros, es basura historica.
- Sin canonical valido hasta el 2026-10-14 (`content` en vez de `href`), Google indexo variantes con query como paginas propias (`/es/contratos/X?tipo-entidad=...`, buscadores filtrados).
- El canonical de `d268ffa` cortaba toda la query: los buscadores filtrados (lo que mas clics trae de los subsitios, 164 en 30 dias) declaraban `/es/buscador` como canonical.
- Mismo contenido con 200 en otros hosts (`todosloscontratos.../es/empresas/X`), con el slug del otro idioma (`/en/empresas/X`) y con barra final. Micrositios sin canonical ni robots. Sin hreflang ni datos estructurados.
- Fichas con canonical de Google en `quienesquien.wiki` ("Page with redirect"): efecto de la mudanza, se resuelve con los 301.

Cambios (`lib/seo.js`, `views/partials/seo-head.hbs`):
- 301 a su host para cualquier pagina pedida en otro de los cuatro hosts, al slug de su idioma, sin barra final, y `/es` o `/en` sueltos a la home del sitio. En beta y local no redirige entre hosts.
- Canonical: fichas y estaticas con el path solo. Buscador con los filtros con valor en orden fijo y `page` si es mayor a 1, sin `subject`, `sort*`, `size`, vacios ni tracking. Micrositios a su host. El par Mujeres `/es/mujeres-en-la-bolsa` y `/en/women-in-the-stock-exchange`; salud y todos-los-contratos solo en espanol.
- hreflang es/en/x-default en lo bilingue.
- noindex,follow: busquedas de texto libre (`name`, `titulo`, `identifier`, `contrato-id`), busquedas sin resultados y los graficos de Mujeres para iframe. Las paginas de error ya tenian noindex.
- JSON-LD: WebSite y Organization en la home, BreadcrumbList mas Person, Organization, GovernmentOrganization o Place en las fichas. Contratos y productos solo breadcrumb (Product pide ofertas y reseñas que no hay).
- `rel=nofollow` en los links de contacto de los modales y del sidebar. robots.txt (solo en el server, backup `/root/qqw-robots.txt.bak-20261015`) con `Disallow` de `/contacto`, `/*/contacto`, `/*/contact` y `/api/`, repetido en el grupo de Googlebot porque Googlebot lee solo su grupo.
- `sitemap_static.xml`: 25 URLs, estaticas en es y en, licencia y los micrositios en sus hosts. Sin `/es/buscador/` con barra (ahora es 301). `lastmod` del indice para ese archivo en 2026-10-15. Backups en `/root/qqw-sitemap*.bak-20261015.xml`.

Verificado: en 29 URLs en es y sus 29 en en el body es identico al commit anterior; las 25 URLs del sitemap estatico dan 200.

Pendiente de SEO:
- Enviar `https://quienesquienwiki.sociedad.info/sitemap/sitemap.xml` en Search Console (`sc-domain:sociedad.info`). Con el permiso restringido de Claude no se puede.
- Buscador con un filtro que no aplica a la coleccion (por ejemplo `proveedor` en empresas): la API lo ignora, devuelve resultados y queda indexable con canonical propio. Caso borde.
- Las URLs viejas con query van a quedar como "Alternate page with proper canonical" o "Crawled - currently not indexed": es lo esperado, no hace falta pedir remocion.
- Revisar en dos o tres semanas el informe de indexacion de paginas en GSC (motivos "Duplicate, Google chose different canonical", "Duplicate without user-selected canonical", "Page with redirect") y el de datos estructurados (Breadcrumbs).


## Gate de anuncios y avisos en lugar de links rotos (`8ad6ec7`, en prod el 2026-10-15)

- `adsbygoogle.js` se inyecta con la primera interaccion humana, como sociedad (`ADS_INTERACTION_GATE=true`, `ADS_MOBILE_OVERLAYS=bottom` en el `.env` de prod, backup `/root/qqw-poppins.env.bak-20261015-gate`). En pantallas de menos de 768 px carga de entrada. Motivo: el 2026-10-15 Hong Kong hizo 24 mil page views y 60 mil solicitudes de anuncios con 3% de cobertura. Probado en Chrome: automatizado no carga, escritorio carga con la primera tecla y recuerda la sesion, movil carga de entrada con `data-overlays="bottom"`.
- Herramientas: aviso de que la API publica, el swagger y la pagina de estado estan fuera de servicio desde junio de 2026 (la zona paso a Deflect el 2026-06-02 y esos subdominios dejaron de existir), temporal, y que nos pidan los datos. "De Kibana a TeseoETL" en herramientas y en la home, con link a `abrimos.info/teseoetl.html`.
- salud-estados: el tablero de `publico-simona` se dio de baja en junio de 2026. Aviso, `noindex` y fuera del sitemap estatico (24 URLs, purgado en Cloudflare).
- A vigilar: cobertura y RPM de AdSense del subdominio en los proximos dias, comparando con el 14 y el 15.

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
- Desde `7559648` cada paso de la barra tambien se manda a `ops@sociedad.info` (`POST /api/aviso`, `lib/aviso.js`), por la API transaccional de Brevo desde `noreply@sociedad.info`, con replyTo de la persona. Solo acepta Origin de los sitios del app, valida el email y corta en 4 por IP por hora y 60 por hora en total, por instancia de pm2.

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

Deflect ya no se usa: la zona `quienesquien.wiki` paso a Cloudflare el 2026-10-14 (abrimos-infra `9387238`). Los numeros de arriba quedan solo como linea base.

Que mirar despues del cambio:

- **Cloudflare, zona `quienesquien.wiki`**: los 200 tienen que pasar a 301. El volumen total deberia seguir parecido mientras los bots sigan pidiendo el dominio viejo.
- **Cloudflare (`quienesquienwiki.sociedad.info`)**: requests, cache hit ratio de la regla de HTML y 429. Se consulta por API GraphQL con el token de Cloudflare via Infisical (`with_cf_token.py` en abrimos-infra).
- **nginx (`/var/log/nginx/qqw.access.log`)**: requests por host por hora. `quienesquien.wiki` tiene que ser solo 301.
- **AdSense**: solicitudes de `quienesquienwiki.sociedad.info` dentro de sociedad.info, y que el aviso "sin CMP" de `www.quienesquien.wiki` deje de crecer.
- **GA (`G-N8DE0W26FL`)**: despues del deploy, menos sesiones de SG, CN, IN y HK por el default denied.
- **Search Console (`sc-domain:sociedad.info`)**: impresiones del subdominio subiendo y las del dominio viejo bajando. Depende del sitemap (punto 4).

## Deploy del 2026-10-14

- Beta temporal: checkout en `/opt/scripts/qqw-poppins-beta` con el `.env` de prod, puerto 3011, proceso pm2 `qqw-poppins-beta`. Probado con curl por Host contra el node de prod (3001) y Chrome headless por tunel. Despues se borro el proceso, el directorio queda.
- Prod: `git merge --ff-only` a `d268ffa` en `/opt/scripts/qqw-poppins` y `pm2 reload qqw-poppins --update-env`.
- Artefacto conocido de probar por http con tunel: `tiza is not defined` aparece igual en prod y en beta, no en https.

## Beta

`https://beta.quienesquienwiki.sociedad.info`, solo por tailnet (cert mkcert de la CA de Abrimos). Checkout en `/opt/scripts/qqw-poppins-beta`, pm2 `qqw-poppins-beta`, puerto 3011. Deploy: `git fetch origin main && git merge --ff-only origin/main` y `pm2 reload qqw-poppins-beta`. Detalle en el session log de abrimos-infra del 2026-10-14.


## Errores y Conversations (`8cdd629`, en prod el 2026-10-14)

- Manejo de errores como sociedad-web-front: la API caida, con 5xx o sin JSON da 503 con `Retry-After`, un 404 de la API da 404, el resto 500. Un solo manejador. Los 404 quedan solo en la linea del request. Pagina de error con noindex, sin canonical ni anuncios y sin el link a `status.quienesquien.wiki`.
- i18n: los `href='{url}'` dentro de las traducciones salian literales desde `ed6aa91` (2025-12-03). Ahora se interpolan con escape HTML.
- La barra amarilla manda copia a Brevo Conversations (`AVISO_CONVERSATIONS=5haj8dz4ttei@brevo-mail.com`, la misma entrada que sociedad y gobernantes). Probado desde beta: entra el ticket, y la respuesta desde Conversations sale de `informes@sociedad.info` al email de la persona.
- Verificado en prod despues del deploy: fichas y buscador 200 con canonical y anuncios, ficha y ruta inexistentes 404 sin canonical ni anuncios y con noindex, JSON roto 400. Ningun 5xx y nada nuevo en el log de errores en los primeros 95 segundos.

## Traducciones y CSS

- En `/en` la pagina de error y la barra amarilla salian en espanol. Traducidas, y el texto del paso 1 de la barra ahora pasa por `_`. Quedan unos 260 textos de otras paginas sin entrada en `en.json` (fichas de contratos y productos, home, privacidad, licencia, modales de reporte): en `/en` salen en espanol.
- `public/stylesheets/style.css` se commitea compilado y no se ignora: en prod nginx lo sirve directo del disco, el middleware de stylus solo lo regenera si el pedido llega al app (en beta todo llega al app). Lo commiteado tiene que ser exactamente lo que genera stylus 0.64.0 desde los `.styl`, si no queda como modificado en los checkouts del server y el `git merge --ff-only` del deploy falla si un commit lo toca. Se edita el `.styl` y se commitea el CSS que sale de pedir `/stylesheets/style.css` al app local.


## Traduccion al ingles del sitio (2026-10-14)

- 33 plantillas del sitio principal pasan sus textos fijos por `_` (182 llamadas, unas 140 claves nuevas). `en.json` tiene traducidos 386 textos que faltaban y unos 110 que tenian el valor en espanol. Quedan con valor igual al espanol solo los slugs de URL (`contratos`, `empresas`, `sobre-qqw`, etc., se usan para armar links) y nombres propios.
- `lib/i18n.js`: la busqueda por jsonpath fallaba con claves multilinea y esos textos nunca se traducian. Ahora busca la clave directo.
- Verificado contra el codigo anterior (mismo commit corriendo en otro puerto, API real por tunel): en 29 URLs en espanol (fichas, contratos, productos, regiones, buscador con filtros, orden y paginacion, paginas estaticas y 404) el texto visible y los atributos title, alt, placeholder y value son identicos. En las mismas URLs en `/en` las palabras en espanol bajan de 5394 a 2139, sin errores de i18n ni de plantillas.
- Mujeres en la Bolsa por pais (`/es/regiones/:id/mujeresenlabolsa`): daba 500 en prod porque la API ya no devuelve los resumenes 2019/2020 para ningun pais (`/v3/areas` no trae `summaries`). Ahora responde 404 en vez de una pagina llena de "Valor desconocido" con anuncios, y los helpers no revientan si faltan los datos.
- `country-mujeres.hbs` no compilaba: 33 llamadas `{{{_"` sin espacio. Corregido.
- Boton de newsletter de la home: decia "newslette" + "r" pegada afuera del helper. Corregido.

## Pendientes

Traducciones:
- Etiquetas de filtros y opciones de orden que vienen de `lib/const.js` ("Contratos y compras", "Empresas y Sociedades", "Proveedor/a", etc.): ya pasan por `_` en `views/partials/filter_element.hbs` y el buscador, pero no tienen entrada en `en.json`. Es lo que mas espanol deja en `/en/buscador`.
- `/en/sobre-qqw` y `/en/entidades-y-fuentes` siguen con mucho texto en espanol. Revisar de donde sale (no parece estar en las plantillas).
- Paginacion: "<< Primera", "< Anterior", "Siguiente >", "Ultima >>" se arman en `lib/lib.js` y la plantilla imprime `{{title}}`, que a veces es un numero (`_` devuelve vacio con numeros). Necesita cambio de codigo.
- Buscador con mas de 100.000 resultados: la clave "de" esta traducida "from" y en ingles se lee "List of 160,584 from contract". Cambiar el valor afecta otros usos de "de".
- "Proveedor(es)" en `contract.hbs` y `record.hbs` no se envolvio: en `es.json` esa clave vale "Proveedor(es/as)" y cambiaria el espanol.
- Links fijos a `/es/` en el buscador (fuentes) y en `institutions-uc.hbs` (`/contacto`).
- `institutions-uc.hbs` lineas 1 a 3: notas de desarrollo ("//ordenar por flags") que se ven en la pagina.
- Los datos de la API (nombres, titulos de contratos, productos) quedan en espanol: no se traducen.

Otros:
- Mujeres en la Bolsa por pais: averiguar si los resumenes se perdieron en la API o se mudaron. Mientras tanto esas paginas dan 404.
- Links rotos a `status`, `api`, `kibana` y `publico-simona.quienesquien.wiki` en `views/apis.hbs`, `sources.hbs` y `salud-estados.hbs` (punto 6).
- Enviar el sitemap nuevo en Search Console (`sc-domain:sociedad.info`).
- Vigilar: ingresos de AdSense fuera del EEE con ads denied por defecto, el aviso "sin CMP" de `www.quienesquien.wiki`, si Conversations agrupa los dos pasos de la barra en un ticket, sesiones de GA de SG, CN, IN y HK.
- Limpieza del repo: docs sin trackear que son de otros repos, `.cursor/plans`, `correo-gandi-dns.md`, `ROUTING_ANALYSIS.md`, el stash de agosto de 2025 y la rama `feature/subfolder-support`.
- abrimos-infra tiene commits locales sin pushear.
