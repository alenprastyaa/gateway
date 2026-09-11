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

module.exports = { clientIp };
