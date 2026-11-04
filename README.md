
Instalar dependencias:
```
npm install
```

Configurar variables de entorno:
```
cp .env.example .env
```

Modificar .env con los valores que corresponden.


Ejecutar:
```
DEBUG=qqw-poppins:* npm start
```

## Tracking (PiTrack)

`track()` en `views/layout.hbs` y la sonda de `public/javascripts/humanSignal.js` mandan los eventos a `POST /api/track` de este mismo sitio. `lib/track.js` los valida (Origin de uno de los hosts del sitio, campo `event`, hasta 3000 bytes), fija `sourceid: qqw-poppins` y los reenvía a PiTrack sin esperar respuesta.

- `PITRACK_URL`: base de PiTrack, sin `/track`. En chocolatefactory es `http://127.0.0.1:8102` (PiTrack escucha solo en 127.0.0.1, no en `::1`). Vacía, el tracking queda apagado y `/api/track` responde `tracking_disabled`. En beta va vacía para no mezclar eventos con los de prod.
- PiTrack acepta solo los origins de su `PITRACK_ALLOWED_ORIGINS`. Un host nuevo de qqw hay que agregarlo ahí también.
- Los POST de bots y crawlers los corta antes el rate limiter (403).

## Rate limiting (paridad con sociedad-web-front)

`lib/rate-limiter.js` y el middleware en `app.js` siguen la misma lógica que **sociedad.info** (país, ASN, crawler/bot/global/subred, bloqueo POST a bots, respuesta 444 en bloqueo duro por país).

En nginx delante de Node conviene enviar los mismos headers que en sociedad: `X-Country-Code`, `X-ASN`, `X-ASN-Org` (ver repo **sociedad-web-front**, directorio `nginx/`).

Si el tráfico pasa por **Cloudflare**, hace falta `cloudflare-real-ip.conf` (real IP desde `CF-Connecting-IP`) **antes** de geoip2; si no, `X-Real-IP $remote_addr` y el ASN serán los de Cloudflare (p. ej. AS13335), no del visitante.
