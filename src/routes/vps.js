const express = require("express");
const crypto = require("crypto");
const rateLimit = require("express-rate-limit");
const { TokenPackage, TokenOrder } = require("../models");
const { createIpaymuRedirectPayment } = require("../lib/ipaymu");
const authenticateVps = require("../middleware/authenticateVps");

const router = express.Router();

const checkoutLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
});

function generateTokenReferenceId() {
  return `TOK-${Date.now().toString(36).toUpperCase()}-${crypto
    .randomBytes(3)
    .toString("hex")
    .toUpperCase()}`;
}

// Called server-to-server by an already-registered tiktok-bisnis VPS on
// behalf of one of its own already-logged-in users (never by a browser
// directly — X-Internal-Secret is a server credential). This is why there's
// no buyer name/phone collection here unlike /api/payments/ipaymu/checkout:
// the user already has an account, we're just topping up their balance.
router.post("/token-checkout", checkoutLimiter, authenticateVps, async (req, res, next) => {
  try {
    const tokenPackageId = Number.parseInt(req.body?.token_package_id, 10);
    const remoteUserId = Number.parseInt(req.body?.user_id, 10);
    const buyerEmail = String(req.body?.buyer_email || "").trim() || null;

    if (!tokenPackageId || !remoteUserId) {
      return res.status(400).json({ message: "token_package_id dan user_id wajib diisi." });
    }

    const pkg = await TokenPackage.findOne({ where: { id: tokenPackageId, is_active: true } });
    if (!pkg) {
      return res.status(404).json({ message: "Paket token tidak ditemukan atau sedang nonaktif." });
    }

    const referenceId = generateTokenReferenceId();
    const amount = Number(pkg.price) || 0;
    const targetVps = req.targetVps;
    const returnBase = String(targetVps.base_url || "").replace(/\/+$/, "");

    const ipaymuResult = await createIpaymuRedirectPayment(req, {
      plan: { name: pkg.name, initial_price: pkg.price, description: pkg.description },
      order: { reference_id: referenceId, amount },
      buyer: { name: `User #${remoteUserId}`, email: buyerEmail || `user${remoteUserId}@${returnBase.replace(/^https?:\/\//, "")}`, phone: "" },
      // notifyUrl is intentionally NOT overridden here — it always stays the
      // gateway's own /api/payments/ipaymu/notify (see buildPaymentCallbackUrls).
      overrideUrls: {
        returnUrl: `${returnBase}/iniq/app?token_payment=success&ref=${encodeURIComponent(referenceId)}`,
        cancelUrl: `${returnBase}/iniq/app?token_payment=cancel&ref=${encodeURIComponent(referenceId)}`,
      },
    });

    const order = await TokenOrder.create({
      reference_id: referenceId,
      token_package_id: pkg.id,
      target_vps_id: targetVps.id,
      remote_user_id: remoteUserId,
      buyer_email: buyerEmail,
      amount,
      token_amount: pkg.token_amount,
      status: "pending",
      ipaymu_session_id: ipaymuResult?.Data?.SessionID || null,
      ipaymu_payment_url: ipaymuResult?.Data?.Url || null,
      ipaymu_response: ipaymuResult,
      callback_payloads: [],
    });

    res.status(201).json({
      reference_id: order.reference_id,
      payment_url: order.ipaymu_payment_url,
    });
  } catch (e) {
    next(e);
  }
});

module.exports = router;
