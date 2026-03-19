# Nginx Configuration Improvements

## Summary of Changes

This document outlines the improvements made to the nginx configuration to fix redirect issues and improve maintainability.

## Key Improvements

### 1. **Eliminated `if` Statements for Redirects**
   - **Before**: Used `if` statements inside server blocks for redirects (nginx anti-pattern)
   - **After**: Created separate server blocks for each redirect scenario
   - **Benefit**: More reliable, better performance, follows nginx best practices

### 2. **Clear Separation of Concerns**
   - **Main Application Server**: Handles all primary domains that proxy to localhost:3001
   - **Domain Redirects**: Separate server blocks for each old domain → new domain redirect
   - **Static Site Server**: Dedicated block for 2019 static site
   - **HTTP to HTTPS**: Clean redirect blocks for all HTTP traffic

### 3. **Fixed Conflicting Redirects**
   - **Before**: Last server block had a redirect but then returned 404
   - **After**: Proper redirect chain: HTTP → HTTPS → final destination
   - **Benefit**: No more broken redirects

### 4. **Improved SSL Configuration**
   - Added SSL session caching and optimizations
   - Enabled HTTP/2 for better performance
   - Proper SSL stapling configuration

### 5. **Better Static Asset Handling**
   - Maintained aggressive caching for static assets
   - Improved compression settings
   - Better cache headers

### 6. **Let's Encrypt Support**
   - All HTTP server blocks now properly handle `.well-known/acme-challenge/`
   - Ensures certificate renewal works correctly

### 7. **Catch-All Server Block**
   - Added default server block that returns 444 for unmatched domains
   - Prevents nginx from using wrong server block for unknown requests

## Domain Mapping

### Primary Application Domains (Proxy to localhost:3001)
- `todosloscontratos.sociedad.info`
- `mujeresenlabolsa.sociedad.info`
- `quienesquienwiki.sociedad.info`
- `saluddineroycorrupcion.sociedad.info`

### Domain Redirects
- `mujeresenlabolsa.org` → `mujeresenlabolsa.sociedad.info/es/mujeres-en-la-bolsa`
- `todosloscontratos.com` → `todosloscontratos.sociedad.info/es/todos-los-contratos`
- `todosloscontratos.mx` → `todosloscontratos.sociedad.info/es/todos-los-contratos`
- `saluddineroycorrupcion.mx` → `saluddineroycorrupcion.sociedad.info/es/salud`
- `quienesquien.wiki` → `quienesquienwiki.sociedad.info/es/inicio` (root) or `quienesquienwiki.sociedad.info$request_uri`
- `www.quienesquien.wiki` → `quienesquienwiki.sociedad.info$request_uri`
- `2019.mujeresenlabolsa.org` → `2019-mujeresenlabolsa.sociedad.info`

### Static Site
- `2019-mujeresenlabolsa.sociedad.info` → Serves from `/var/www/mujeres2019`

## Migration Steps

1. **Backup current configuration**:
   ```bash
   sudo cp /etc/nginx/sites-available/your-site /etc/nginx/sites-available/your-site.backup
   ```

2. **Test the new configuration**:
   ```bash
   sudo nginx -t
   ```

3. **If test passes, replace the configuration**:
   ```bash
   sudo cp nginx-improved.conf /etc/nginx/sites-available/your-site
   ```

4. **Reload nginx**:
   ```bash
   sudo systemctl reload nginx
   ```

5. **Monitor logs**:
   ```bash
   sudo tail -f /var/log/nginx/qqw.access.log
   sudo tail -f /var/log/nginx/qqw.error.log
   ```

## Testing Checklist

- [ ] All primary domains load correctly
- [ ] All old domain redirects work (HTTP and HTTPS)
- [ ] HTTP to HTTPS redirects work
- [ ] Static assets are served correctly
- [ ] Caching is working (check X-Cache-Status header)
- [ ] Let's Encrypt renewal works
- [ ] No 404 errors for valid domains
- [ ] No redirect loops

### 8. **GeoIP2 Country Detection**

Nginx resolves the client's country (ISO 3166-1 alpha-2 code) via the DB-IP free database and
forwards it to the Node.js app as `X-Country-Code`. The app logs it on every request; it can also
be used for country-based rate limiting or blocking without an additional lookup in Node.

**Files added:**
- `geoip2-country.conf` — `http {}` context snippet (include in `/etc/nginx/nginx.conf`)
- `update-geoip.sh` — download/update script for the DB-IP database

**One-time server setup (as root):**
```bash
# 1. Install the nginx geoip2 module (may already be present)
apt install libnginx-mod-http-geoip2

# 2. Install the update script
cp nginx/update-geoip.sh /usr/local/bin/update-geoip
chmod +x /usr/local/bin/update-geoip

# 3. Download the database (no account required — DB-IP free tier, CC BY 4.0)
update-geoip

# 4. Add the snippet to the http {} block in /etc/nginx/nginx.conf
#    include /etc/nginx/geoip2-country.conf;
cp nginx/geoip2-country.conf /etc/nginx/geoip2-country.conf

# 5. Deploy updated vhost configs and reload
nginx -t && systemctl reload nginx

# 6. Monthly auto-update cron (runs 2nd of each month at 3am)
echo "0 3 2 * * root /usr/local/bin/update-geoip" > /etc/cron.d/update-geoip
```

**Database source:** https://db-ip.com/db/download/ip-to-country-lite — updated monthly, no
registration needed. The update script constructs the URL from the current year/month and reloads
nginx automatically on success.

## Notes

- The configuration maintains all existing functionality (caching, compression, CORS, etc.)
- Proxy settings are optimized for the Node.js application on port 3001
- Static assets are aggressively cached for performance
- All redirects use 301 (permanent) for SEO benefits



