const express = require("express");
const crypto = require("crypto");
const rateLimit = require("express-rate-limit");
const {
  TokenPackage,
  TokenOrder,
  Customer,
  ProductionPricing,
  ProductionOrder,
  PackagePlan,
  PackageMapping,
} = require("../models");
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

// PRJ- marks a production-year renewal. iPaymu is configured with exactly one
// notifyUrl, so the prefix is how that single webhook decides which table an
// incoming callback belongs to — same trick TOK- plays. A new prefix must
// never be a prefix of an existing one, or the webhook's startsWith checks
// start matching the wrong table.
function generateProductionReferenceId() {
  return `PRJ-${Date.now().toString(36).toUpperCase()}-${crypto
    .randomBytes(3)
    .toString("hex")
    .toUpperCase()}`;
}

// The single fallback price. Always row 1 — see ProductionPricing's header
// for why this is a table and why it lives here rather than on the backend
// VPS. Kept alive as the FLOOR of the resolution order below, not the primary
// source anymore (2026-09-05) — see resolveProductionUnitPrice.
async function getProductionYearlyPrice() {
  const row = await ProductionPricing.findByPk(1);
  const price = Number(row?.yearly_price);
  if (!Number.isFinite(price) || price <= 0) {
    // Refusing is the only safe answer. Falling back to a constant would
    // charge a real customer a number nobody configured, through a shared
    // merchant account.
    throw new Error("Harga produksi belum dikonfigurasi di gateway.");
  }
  return price;
}

// What one production year costs for THIS account, on THIS VPS (2026-09-05).
//
// Per-package pricing reuses PackagePlan.renewal_price — the "Harga
// Perpanjangan" field the admin CMS has always had for package plans, sitting
// on the same object the registration flow already reads initial_price from.
// It was administrative furniture until now: never consulted anywhere to
// compute an actual charge. This is the first thing that reads it.
//
// The resolution order mirrors the one already established on the backend
// VPS for project/production quotas (per-account override -> package ->
// floor, see getProjectQuota/getProductionQuota in
// src/services/billing/production.js): specific overrides general, and there
// is always a floor so no account is ever unable to pay.
//
//   1. The account's package, resolved via PackageMapping — remotePackageId
//      is the VPS's OWN local package id (opaque to the gateway), the exact
//      value PackageMapping.remote_package_id exists to translate into a
//      package_plan_id this gateway understands.
//   2. ProductionPricing.yearly_price, the global fallback — for accounts
//      with no package, an unmapped package, or a plan whose renewal_price is
//      0. Zero is read as "not configured for self-serve" rather than "free
//      this year": Custom/negotiated plans default to 0 precisely because
//      their price is set by hand, not through checkout, and charging Rp0
//      through a shared merchant account for a real product would be a
//      revenue bug wearing the shape of a feature.
//
// Never throws on a missing/unmapped package — that is an expected shape
// (plenty of accounts have no package_id at all), not a configuration error.
// It throws only if the floor itself is unset, same as before.
async function resolveProductionUnitPrice(targetVps, remotePackageId) {
  if (remotePackageId) {
    const mapping = await PackageMapping.findOne({
      where: { target_vps_id: targetVps.id, remote_package_id: remotePackageId },
    });
    if (mapping) {
      const plan = await PackagePlan.findByPk(mapping.package_plan_id);
      const price = Number(plan?.renewal_price);
      if (Number.isFinite(price) && price > 0) {
        return price;
      }
    }
  }
  return getProductionYearlyPrice();
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

// Production-app renewal (2026-09-05). Called server-to-server by a backend
// VPS on behalf of one of its logged-in users, exactly like /token-checkout
// above and with the same trust boundary (X-Internal-Secret via
// authenticateVps).
//
// ONE order covers MANY projects. The customer ticks which apps to renew and
// pays once; three apps would otherwise mean three iPaymu checkouts, three
// payment fees, and three chances to abandon the flow halfway.
//
// The caller sends project ids, which package the account is on, and
// nothing else about money. Price and total are computed HERE, from the
// package's renewal_price (or the global fallback) — the backend VPS never
// states an amount, because the iPaymu merchant account is shared and a VPS
// that could name its own price could charge anything through it.
router.post("/production-checkout", checkoutLimiter, authenticateVps, async (req, res, next) => {
  try {
    const remoteUserId = Number.parseInt(req.body?.user_id, 10);
    const buyerEmail = String(req.body?.buyer_email || "").trim() || null;
    /* The VPS's own local package id for this account — opaque here, just
     * the key resolveProductionUnitPrice looks up in PackageMapping. null
     * (not 0) when the account has no package, which the caller must send
     * as the raw column value rather than a resolved default so an unmapped
     * account is visibly unmapped instead of silently landing on some
     * default plan's price. */
    const remotePackageId = Number.parseInt(req.body?.package_id, 10) || null;

    /* Deduplicated before counting: the same id sent twice must not be billed
     * twice, and it would extend that one project only once anyway — the
     * backend applies a year per project, not per list entry. */
    const projectIds = Array.from(
      new Set(
        (Array.isArray(req.body?.project_ids) ? req.body.project_ids : [])
          .map((value) => Number.parseInt(value, 10))
          .filter((value) => Number.isInteger(value) && value > 0)
      )
    );

    if (!remoteUserId || projectIds.length === 0) {
      return res
        .status(400)
        .json({ message: "user_id dan project_ids (minimal satu) wajib diisi." });
    }

    /* An upper bound so one request cannot build an order of unbounded size —
     * both the iPaymu payload and the extension loop on the backend scale
     * with this list, and nobody legitimately renews 50 apps at once. */
    if (projectIds.length > 25) {
      return res
        .status(400)
        .json({ message: "Maksimal 25 aplikasi dalam satu transaksi perpanjangan." });
    }

    const unitPrice = await resolveProductionUnitPrice(req.targetVps, remotePackageId);
    const amount = unitPrice * projectIds.length;

    const referenceId = generateProductionReferenceId();
    const targetVps = req.targetVps;
    const returnBase = String(targetVps.base_url || "").replace(/\/+$/, "");

    const ipaymuResult = await createIpaymuRedirectPayment(req, {
      plan: {
        name: `Perpanjangan aplikasi produksi (${projectIds.length} aplikasi)`,
        initial_price: amount,
        description: "Biaya tahunan aplikasi produksi",
      },
      order: { reference_id: referenceId, amount },
      // Same placeholder phone as token-checkout: iPaymu rejects an empty
      // buyerPhone and reports it as "unauthorized signature" rather than a
      // validation error, and this flow never collects one.
      buyer: {
        name: `User #${remoteUserId}`,
        email:
          buyerEmail || `user${remoteUserId}@${returnBase.replace(/^https?:\/\//, "")}`,
        phone: "081200000000",
      },
      // notifyUrl stays the gateway's own /api/payments/ipaymu/notify.
      overrideUrls: {
        returnUrl: `${returnBase}/studio/perpanjangan?production_payment=success&ref=${encodeURIComponent(referenceId)}`,
        cancelUrl: `${returnBase}/studio/perpanjangan?production_payment=cancel&ref=${encodeURIComponent(referenceId)}`,
      },
    });

    const order = await ProductionOrder.create({
      reference_id: referenceId,
      target_vps_id: targetVps.id,
      remote_user_id: remoteUserId,
      buyer_email: buyerEmail,
      remote_project_ids: projectIds,
      project_count: projectIds.length,
      unit_price: unitPrice,
      amount,
      status: "pending",
      ipaymu_session_id: ipaymuResult?.Data?.SessionID || null,
      ipaymu_payment_url: ipaymuResult?.Data?.Url || null,
      ipaymu_response: ipaymuResult,
      callback_payloads: [],
    });

    res.status(201).json({
      reference_id: order.reference_id,
      payment_url: order.ipaymu_payment_url,
      amount: order.amount,
      unit_price: order.unit_price,
      project_count: order.project_count,
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
