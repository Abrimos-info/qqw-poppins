
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

## Rate limiting (paridad con sociedad-web-front)

`lib/rate-limiter.js` y el middleware en `app.js` siguen la misma lógica que **sociedad.info** (país, ASN, crawler/bot/global/subred, bloqueo POST a bots, respuesta 444 en bloqueo duro por país).

En nginx delante de Node conviene enviar los mismos headers que en sociedad: `X-Country-Code`, `X-ASN`, `X-ASN-Org` (ver repo **sociedad-web-front**, directorio `nginx/`).

Si el tráfico pasa por **Cloudflare**, hace falta `cloudflare-real-ip.conf` (real IP desde `CF-Connecting-IP`) **antes** de geoip2; si no, `X-Real-IP $remote_addr` y el ASN serán los de Cloudflare (p. ej. AS13335), no del visitante.
