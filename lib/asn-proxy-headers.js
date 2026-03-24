"use strict";

/**
 * ASN fields from reverse proxy (e.g. nginx geoip2_asn → x-asn, x-asn-org).
 * Kept in a tiny module so tests do not load the full router.
 *
 * @param {import("http").IncomingHttpHeaders | Record<string, string | string[] | undefined>} [headers]
 * @returns {{ asn: string, asnOrg: string }}
 */
function readProxyAsnHeaders(headers) {
  const h = headers || {};
  return {
    asn: h["x-asn"] || "",
    asnOrg: h["x-asn-org"] || "",
  };
}

module.exports = { readProxyAsnHeaders };
