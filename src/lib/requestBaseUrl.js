const env = require("../config/env");

// Ported from tiktok-bisnis app.js:2745-2790 — same private-host rejection so
// checkout/notify URLs are never built from a localhost/LAN address by mistake.
function getRequestBaseUrl(req) {
  if (env.PUBLIC_BASE_URL) return env.PUBLIC_BASE_URL;
  return `${req.protocol}://${req.get("host")}`;
}

function isPublicHttpUrl(value) {
  try {
    const parsed = new URL(value);
    const host = parsed.hostname;
    const isPrivateHost =
      host === "localhost" ||
      host === "127.0.0.1" ||
      /^10\./.test(host) ||
      /^192\.168\./.test(host) ||
      /^172\.(1[6-9]|2\d|3[0-1])\./.test(host);

    return (
      (parsed.protocol === "http:" || parsed.protocol === "https:") &&
      !isPrivateHost
    );
  } catch (e) {
    return false;
  }
}

function buildPaymentCallbackUrls(req, referenceId) {
  const baseUrl = getRequestBaseUrl(req);
  if (!isPublicHttpUrl(baseUrl)) {
    return {};
  }

  const encodedReferenceId = encodeURIComponent(referenceId);
  return {
    returnUrl: `${baseUrl}/?payment=success&ref=${encodedReferenceId}`,
    notifyUrl: `${baseUrl}/api/payments/ipaymu/notify`,
    cancelUrl: `${baseUrl}/?payment=cancel&ref=${encodedReferenceId}`,
  };
}

module.exports = { getRequestBaseUrl, isPublicHttpUrl, buildPaymentCallbackUrls };
