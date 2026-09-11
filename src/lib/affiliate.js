const axios = require("axios");
const crypto = require("crypto");
const { decryptSecret } = require("./crypto");
const { pickActiveTarget } = require("./quota");

// Referral support on the gateway side (2026-09-11).
//
// The gateway owns NOTHING about affiliates. It captures a code from a URL,
// shows the visitor whose link they followed, counts the click, and carries the
// code onto the order. Every decision — is this code real, does it earn, how
// much, to whom — belongs to the backend VPS, which holds the user graph and
// the point ledger.
//
// Both calls below target the VPS a NEW REGISTRATION would be routed to
// (pickActiveTarget), because that is the VPS the resulting account will live
// on and therefore the one whose referral graph is relevant. With a single
// backend VPS this is unambiguous; if several are ever active at once, a code
// issued on one would not resolve against another, and the honest failure is
// "unknown code" rather than a silently mis-attributed commission.
//
// Device and IP are HASHED before they leave here. The backend only needs to
// tell repeat visits apart and spot abuse patterns; it has no business holding
// raw addresses for people who merely opened a link.

const HASH_SALT = "affiliate-click-v1";

function hashValue(value) {
  if (!value) return null;
  return crypto
    .createHash("sha256")
    .update(`${HASH_SALT}:${String(value)}`)
    .digest("hex")
    .slice(0, 64);
}

async function callBackend(path, { method = "get", params, data, timeout = 5000 }) {
  const targetVps = await pickActiveTarget();
  if (!targetVps) return null;

  const secret = decryptSecret(targetVps.internal_secret_encrypted);
  const url = `${String(targetVps.base_url).replace(/\/+$/, "")}/iniq${path}`;

  const response = await axios({
    method,
    url,
    params,
    data,
    headers: { "X-Internal-Secret": secret },
    // Short: both calls sit in front of a visitor waiting for a page. A slow
    // backend must degrade to "no referral banner", never to a slow checkout.
    timeout,
    validateStatus: () => true,
  });

  if (response.status >= 200 && response.status < 300) return response.data;
  return null;
}

// Is this code real, and whose is it? Returns null when it cannot be decided —
// the caller treats that as "unknown", never as "valid".
async function resolveReferralCode(code) {
  const raw = String(code || "").trim().toUpperCase();
  if (!raw || raw.length < 6 || raw.length > 16 || !/^[A-Z0-9]+$/.test(raw)) return null;
  try {
    const data = await callBackend("/api/internal/affiliate/resolve-code", {
      params: { code: raw },
    });
    if (!data || !data.valid) return null;
    return data;
  } catch (e) {
    console.warn("[affiliate] resolve-code gagal:", e.message);
    return null;
  }
}

// Best-effort click count. Never throws and never blocks: a visitor's page load
// must not depend on analytics reaching another server.
async function reportReferralClick({ code, ip, deviceId, source }) {
  try {
    await callBackend("/api/internal/affiliate/click", {
      method: "post",
      data: {
        code: String(code || "").trim().toUpperCase(),
        device_hash: hashValue(deviceId),
        ip_hash: hashValue(ip),
        source: source || "checkout",
      },
      timeout: 3000,
    });
  } catch (e) {
    // Deliberately swallowed — see the header.
  }
}

module.exports = { resolveReferralCode, reportReferralClick, hashValue };
