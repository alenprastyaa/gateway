const express = require("express");
const crypto = require("crypto");
const rateLimit = require("express-rate-limit");
const { TokenPackage, TokenOrder, Customer } = require("../models");
const { createIpaymuRedirectPayment } = require("../lib/ipaymu");
const { verifyPassword } = require("../lib/auth");
const { upsertCustomerCredential } = require("../lib/provisioning");
const authenticateVps = require("../middleware/authenticateVps");

const router = express.Router();

const checkoutLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
});

// Tighter than checkoutLimiter on purpose — this endpoint exists to answer
// "does this password match", which is exactly the kind of thing brute-force
// guessing targets. authenticateVps already requires a valid X-Internal-Secret
// before this ever runs (so it's not open to the whole internet), but a
// compromised/leaked backend-VPS secret shouldn't also buy unlimited password
// guesses against every customer account.
const verifyLoginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
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
      // iPaymu rejects checkout requests with an empty buyerPhone (surfaced
      // misleadingly as "unauthorized signature" rather than a validation
      // error) — this flow never collects a phone since the user is already
      // logged in on the backend VPS, so send a fixed placeholder instead.
      buyer: { name: `User #${remoteUserId}`, email: buyerEmail || `user${remoteUserId}@${returnBase.replace(/^https?:\/\//, "")}`, phone: "081200000000" },
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

// Called server-to-server by a tiktok-bisnis backend VPS to verify a
// customer's login password (2026-08-17, user-identity slice) — the
// customer/password pair this checks against was mirrored here by
// src/lib/provisioning.js's upsertCustomerCredential, from the SAME
// plaintext password the backend VPS itself generated at provisioning
// time. This endpoint deliberately returns nothing beyond {valid, reason} —
// no user profile, no billing/subscription fields. The backend VPS already
// owns and correctly maintains all of that itself (grantSubscriptionAccess
// etc.); duplicating it here would just create a second copy that can drift.
router.post("/verify-login", verifyLoginLimiter, authenticateVps, async (req, res, next) => {
  try {
    const username = String(req.body?.username || "").trim();
    const password = String(req.body?.password || "");
    if (!username || !password) {
      return res.status(400).json({ valid: false, reason: "missing_credentials" });
    }

    const customer = await Customer.findOne({
      where: { target_vps_id: req.targetVps.id, username },
    });
    if (!customer) {
      return res.status(404).json({ valid: false, reason: "user_not_found" });
    }

    const ok = await verifyPassword(password, customer.password_hash);
    if (!ok) {
      return res.status(401).json({ valid: false, reason: "invalid_password" });
    }

    res.json({ valid: true });
  } catch (e) {
    next(e);
  }
});

// Called server-to-server (2026-08-22, change-password fix) after the
// backend VPS's own /api/auth/change-password route has already verified
// the caller's CURRENT password via /verify-login above — this endpoint
// trusts that check happened and does not re-verify anything itself, same
// trust boundary as token-checkout/verify-login (X-Internal-Secret via
// authenticateVps). Reuses the same upsertCustomerCredential() that
// provisioning already calls, so this is the one place that ever writes
// Customer.password_hash, whether at account creation or afterwards.
router.post("/update-password", verifyLoginLimiter, authenticateVps, async (req, res, next) => {
  try {
    const username = String(req.body?.username || "").trim();
    const newPassword = String(req.body?.new_password || "");
    if (!username || !newPassword) {
      return res.status(400).json({ message: "username dan new_password wajib diisi." });
    }

    const customer = await Customer.findOne({
      where: { target_vps_id: req.targetVps.id, username },
    });
    if (!customer) {
      return res.status(404).json({ message: "Customer tidak ditemukan." });
    }

    await upsertCustomerCredential(req.targetVps, { username, password: newPassword });
    res.json({ success: true });
  } catch (e) {
    next(e);
  }
});

module.exports = router;
