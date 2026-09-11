// The real client IP for rate-limiting (2026-09-10).
//
// The gateway runs behind nginx, which is configured with:
//   proxy_set_header X-Real-IP        $remote_addr;                 (overwrites)
//   proxy_set_header X-Forwarded-For  $proxy_add_x_forwarded_for;   (appends)
//
// With `trust proxy: 1`, express-rate-limit's default key (req.ip) reads the
// entry to the LEFT of nginx's appended address in X-Forwarded-For — which is
// whatever the client put there. So a script rotating a fake X-Forwarded-For
// header on every request lands in a new bucket each time and the per-IP
// limiters (admin login, checkout) never trip. That is a brute-force bypass.
//
// X-Real-IP does not have this problem: nginx SETS it to $remote_addr (the real
// TCP peer) with proxy_set_header, which replaces any value the client sent, so
// the client cannot forge it. Key every limiter on this instead.
//
// Falls back to req.ip when the header is absent (direct/local hits: health
// checks, dev without the proxy) so nothing breaks off the nginx path.
function clientIp(req) {
  const realIp = req.headers["x-real-ip"];
  if (realIp) {
    // Defensive: if this ever sat behind two proxies, X-Real-IP could carry a
    // list; take the first entry.
    return String(realIp).split(",")[0].trim();
  }
  return req.ip;
}

const crypto = require("crypto");

// A device identifier for rate-limiting (2026-09-11).
//
// The checkout page and admin panel each mint a random, persistent id in
// localStorage and send it as X-Device-Id. This is a CLIENT-SET value, so an
// attacker can rotate it — it is a COMPLEMENTARY signal, never a hard control.
// Its value: it survives IP changes, so a single browser hopping across proxy
// IPs is still one bucket for the per-device limiter, catching an attacker the
// per-IP ceiling misses; and it separates distinct devices behind one shared
// NAT IP so a limiter can throttle the abusive one without punishing innocent
// co-users. The hard controls remain the per-IP ceiling (unspoofable) and, for
// admin login, the per-username lockout.
//
// Only a well-formed id is trusted; anything else (missing, junk, oversized)
// falls back to a hash of the User-Agent so there is always a bucket, coarse
// but never client-chosen. The header value is untrusted input — validated
// against a strict charset before use, never interpolated anywhere raw.
function deviceId(req) {
  const raw = req.headers["x-device-id"];
  if (typeof raw === "string" && /^[A-Za-z0-9_-]{8,64}$/.test(raw)) {
    return raw;
  }
  const ua = String(req.headers["user-agent"] || "unknown");
  return "ua:" + crypto.createHash("sha1").update(ua).digest("hex").slice(0, 16);
}

// Composite key for device-aware limiters: the real IP AND the device, so a
// bucket is per-(ip, device). Used alongside — not instead of — the per-IP
// limiters, which stay as the unforgeable ceiling.
function throttleKey(req) {
  return clientIp(req) + "|" + deviceId(req);
}

module.exports = { clientIp, deviceId, throttleKey };
