#!/bin/bash
# Download/update the DB-IP country database (no account required)
# https://db-ip.com/db/download/ip-to-country-lite  (CC BY 4.0)
#
# Usage:
#   bash update-geoip.sh              # download current month
#   bash update-geoip.sh 2026 03      # download specific year/month
#
# Install (run once as root):
#   cp update-geoip.sh /usr/local/bin/update-geoip
#   chmod +x /usr/local/bin/update-geoip
#
# Auto-update (monthly cron as root):
#   echo "0 3 2 * * root /usr/local/bin/update-geoip" > /etc/cron.d/update-geoip

set -euo pipefail

DEST=/usr/share/GeoIP/dbip-country.mmdb
TMP=$(mktemp /tmp/dbip-country-XXXXXX.mmdb.gz)

YEAR=${1:-$(date +%Y)}
MONTH=${2:-$(date +%m)}
URL="https://download.db-ip.com/free/dbip-country-lite-${YEAR}-${MONTH}.mmdb.gz"

echo "[update-geoip] Downloading ${URL} ..."
curl -fsSL "$URL" -o "$TMP"

echo "[update-geoip] Decompressing ..."
gunzip -c "$TMP" > "${DEST}.new"
rm -f "$TMP"

# Basic sanity check — mmdb files start with the string "MaxMind"... or db-ip uses same magic
if ! file "${DEST}.new" | grep -qi "data\|binary"; then
    echo "[update-geoip] ERROR: Downloaded file does not look like a valid mmdb" >&2
    rm -f "${DEST}.new"
    exit 1
fi

mv "${DEST}.new" "$DEST"
echo "[update-geoip] Installed to ${DEST}"

# Reload nginx if running
if nginx -t 2>/dev/null; then
    systemctl reload nginx
    echo "[update-geoip] nginx reloaded"
else
    echo "[update-geoip] WARNING: nginx config test failed, not reloading" >&2
fi
