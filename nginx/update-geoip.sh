#!/bin/bash
# Download/update the DB-IP country and ASN databases (no account required)
# https://db-ip.com/db/download/ip-to-country-lite  (CC BY 4.0)
# https://db-ip.com/db/download/ip-to-asn-lite       (CC BY 4.0)
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

YEAR=${1:-$(date +%Y)}
MONTH=${2:-$(date +%m)}
# DB-IP URLs use zero-padded months (2026-03). 10# avoids octal interpretation of 08/09.
MONTH=$(printf '%02d' "$((10#$MONTH))")

download_mmdb() {
  local NAME="$1"
  local URL="$2"
  local DEST="$3"
  local TMP
  TMP=$(mktemp /tmp/dbip-${NAME}-XXXXXX.mmdb.gz)

  echo "[update-geoip] Downloading ${URL} ..."
  curl -fsSL "$URL" -o "$TMP"

  echo "[update-geoip] Decompressing ${NAME} ..."
  mkdir -p "$(dirname "$DEST")"
  gunzip -c "$TMP" > "${DEST}.new"
  rm -f "$TMP"

  if ! file "${DEST}.new" | grep -qi "data\|binary"; then
    echo "[update-geoip] ERROR: ${NAME} does not look like a valid mmdb" >&2
    rm -f "${DEST}.new"
    return 1
  fi

  mv "${DEST}.new" "$DEST"
  echo "[update-geoip] Installed ${NAME} to ${DEST}"
}

download_mmdb "country" \
  "https://download.db-ip.com/free/dbip-country-lite-${YEAR}-${MONTH}.mmdb.gz" \
  "/usr/share/GeoIP/dbip-country.mmdb"

download_mmdb "asn" \
  "https://download.db-ip.com/free/dbip-asn-lite-${YEAR}-${MONTH}.mmdb.gz" \
  "/usr/share/GeoIP/dbip-asn.mmdb"

for f in /usr/share/GeoIP/dbip-country.mmdb /usr/share/GeoIP/dbip-asn.mmdb; do
  if [[ ! -s "$f" ]]; then
    echo "[update-geoip] ERROR: missing or empty file: $f" >&2
    exit 1
  fi
done

# Reload nginx if running
if nginx -t 2>/dev/null; then
    systemctl reload nginx
    echo "[update-geoip] nginx reloaded"
else
    echo "[update-geoip] WARNING: nginx config test failed, not reloading" >&2
fi
