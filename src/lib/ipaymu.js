const crypto = require("crypto");
const env = require("../config/env");
const { buildPaymentCallbackUrls } = require("./requestBaseUrl");

// Ported near-verbatim from tiktok-bisnis app.js:2981-3048 — same signing
// algorithm, same failure-message handling for the IP-whitelist error.

function buildIpaymuTimestamp() {
  return new Date().toISOString().replace(/[-:.]/g, "").slice(0, 14);
}

function createIpaymuSignature(method, payload) {
  const requestJson = JSON.stringify(payload || {});
  const bodyHash = crypto.createHash("sha256").update(requestJson).digest("hex");
  const stringToSign = `${method.toUpperCase()}:${env.IPAYMU_VA}:${bodyHash}:${env.IPAYMU_API_KEY}`;
  return crypto.createHmac("sha256", env.IPAYMU_API_KEY).update(stringToSign).digest("hex");
}

async function createIpaymuRedirectPayment(req, { plan, order, buyer, overrideUrls }) {
  if (!env.IPAYMU_VA || !env.IPAYMU_API_KEY) {
    throw new Error("Konfigurasi iPaymu belum lengkap di .env.");
  }

  const payload = {
    product: [plan.name],
    qty: [1],
    price: [Number(order.amount) || Number(plan.initial_price) || 0],
    description: [plan.description || `Pembelian paket ${plan.name}`],
    referenceId: order.reference_id,
    ...buildPaymentCallbackUrls(req, order.reference_id),
    ...(overrideUrls || {}),
    buyerName: buyer.name,
    buyerEmail: buyer.email,
    buyerPhone: buyer.phone,
    expired: 24,
    feeDirection: "BUYER",
    lang: "id",
  };
  const timestamp = buildIpaymuTimestamp();
  const signature = createIpaymuSignature("POST", payload);

  const response = await fetch(`${env.IPAYMU_BASE_URL}/api/v2/payment`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      va: env.IPAYMU_VA,
      signature,
      timestamp,
    },
    body: JSON.stringify(payload),
  });

  const result = await response.json().catch(() => null);
  if (!response.ok || !result || Number(result.Status || result.status) !== 200) {
    let message = result?.Message || result?.message || "Gagal membuat pembayaran iPaymu.";
    if (String(message).toLowerCase().includes("invalid ip")) {
      message =
        "iPaymu menolak request: Invalid IP. Pastikan IP publik landing-gateway ini sudah di-whitelist di dashboard iPaymu.";
    }
    throw new Error(message);
  }

  return result;
}

// iPaymu callback (notify) fields per https://docs.ipaymu.com/docs/callback:
// these are sent as strings over x-www-form-urlencoded/JSON and must be
// coerced back to their real types before the signature can be recomputed.
const CALLBACK_INT_FIELDS = ["trx_id", "status_code", "transaction_status_code", "paid_off"];

function normalizeIpaymuCallbackData(rawData) {
  const result = {};
  for (const key of Object.keys(rawData || {})) {
    const val = rawData[key];
    if (key === "signature") continue;
    if (key === "is_escrow") {
      result[key] = val === true || val === 1 || val === "1" || val === "true";
    } else if (CALLBACK_INT_FIELDS.includes(key)) {
      const n = Number.parseInt(val, 10);
      result[key] = Number.isNaN(n) ? val : n;
    } else if (key === "additional_info") {
      result[key] = val === "[]" ? [] : val;
    } else {
      result[key] = String(val);
    }
  }
  if (!("additional_info" in result)) result.additional_info = [];
  return result;
}

// Verifies the callback actually came from iPaymu. The secret here is the
// merchant VA number (not the API key) — this is iPaymu's own convention,
// documented at https://docs.ipaymu.com/docs/callback#signature-validation.
// Without this check anyone can POST a fake "berhasil" payload straight to
// the notify endpoint and get an order marked paid for free.
function verifyIpaymuCallbackSignature(rawBody, receivedSignature) {
  if (!receivedSignature || !env.IPAYMU_VA) return false;

  const normalized = normalizeIpaymuCallbackData(rawBody);
  const sortedKeys = Object.keys(normalized).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const sorted = {};
  for (const key of sortedKeys) sorted[key] = normalized[key];

  const jsonBody = JSON.stringify(sorted).replace(/\//g, "\\/");
  const calculated = crypto.createHmac("sha256", env.IPAYMU_VA).update(jsonBody).digest("hex");

  const calculatedBuf = Buffer.from(calculated, "hex");
  const receivedBuf = Buffer.from(String(receivedSignature), "hex");
  if (calculatedBuf.length !== receivedBuf.length) return false;
  return crypto.timingSafeEqual(calculatedBuf, receivedBuf);
}

module.exports = {
  buildIpaymuTimestamp,
  createIpaymuSignature,
  createIpaymuRedirectPayment,
  verifyIpaymuCallbackSignature,
};
