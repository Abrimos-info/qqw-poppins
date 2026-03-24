# Nginx snippets in this repo

**GeoIP2 scripts and `geoip2-*.conf` for sociedad.info / Node live in the `sociedad-web-front` repo:**  
`https://gitlab.com/anticoding/sociedad-web-front` → directory `nginx/`

Use that tree as the source of truth for `update-geoip.sh`, `geoip2-country.conf`, and `geoip2-asn.conf` to avoid duplicated, diverging copies.

Other files here (`sociedad.info`, `qqw.sociedad.info`, `nginx-improved.conf`, etc.) remain specific to QQW Poppins deployments.
