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

async function createIpaymuRedirectPayment(req, { plan, order, buyer }) {
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

module.exports = { buildIpaymuTimestamp, createIpaymuSignature, createIpaymuRedirectPayment };
