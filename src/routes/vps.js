const express = require("express");
const crypto = require("crypto");
const rateLimit = require("express-rate-limit");
const {
  TokenPackage,
  TokenOrder,
  Customer,
  ProductionPricing,
  ProductionOrder,
  SlotPricing,
  SlotOrder,
  PackagePlan,
  PackageMapping,
  Discount,
} = require("../models");
const { createIpaymuRedirectPayment } = require("../lib/ipaymu");
const { verifyPassword, hashPassword } = require("../lib/auth");
const authenticateVps = require("../middleware/authenticateVps");
const { clientIp } = require("../lib/clientIp");

const router = express.Router();

// Keyed on X-Real-IP (unspoofable behind nginx) rather than the default req.ip.
// These are server-to-server calls from a backend VPS, whose real IP nginx
// stamps into X-Real-IP; the default key would read a forgeable X-Forwarded-For.
const checkoutLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: clientIp,
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
  keyGenerator: clientIp,
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

// SLT- marks an extra-slot purchase (2026-10-21). Never a prefix of TOK- or
// PRJ-, for the reason given above.
function generateSlotReferenceId() {
  return `SLT-${Date.now().toString(36).toUpperCase()}-${crypto
    .randomBytes(3)
    .toString("hex")
    .toUpperCase()}`;
}

// One purchase may add at most this many of each kind. A sanity ceiling, not a
// business rule: it keeps a typo (or a hostile caller) from building an order
// whose total no customer meant to pay.
const MAX_SLOTS_PER_ORDER = 20;

// What the two slot kinds cost right now. A price of 0 means the kind is not
// for sale (the migration seeds both at 0), so the answer is explicit about it
// rather than letting a free checkout through.
async function readSlotPrices() {
  const row = await SlotPricing.findByPk(1);
  const project = Number(row?.project_slot_price);
  const production = Number(row?.production_slot_price);
  return {
    project_slot_price: Number.isFinite(project) && project > 0 ? project : 0,
    production_slot_price: Number.isFinite(production) && production > 0 ? production : 0,
  };
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

// What THIS account would actually pay for a production year, for display
// before checkout (2026-09-05).
//
// Found missing by testing, not by design review: the renewal page showed a
// flat Rp150.000 for every account, because it read the OLD public endpoint
// below — unauthenticated, so it has no idea which VPS or which account is
// asking, and can only ever return the global fallback row. Once pricing
// became per-package, that page was quietly wrong for every account whose
// package has its own renewal_price: the number shown before payment did not
// match the number iPaymu would actually charge.
//
// This calls the exact same resolveProductionUnitPrice checkout uses, so the
// display price and the charged price cannot drift apart — there is no
// second implementation of "what does this account pay" to keep in sync.
// GET and no checkoutLimiter on purpose: this does nothing but read two
// rows, unlike the checkout routes below which call out to iPaymu and create
// a real order.
router.get("/production-pricing", authenticateVps, async (req, res, next) => {
  try {
    const remotePackageId = Number.parseInt(req.query?.package_id, 10) || null;
    const price = await resolveProductionUnitPrice(req.targetVps, remotePackageId);
    res.json({ yearly_price: price });
  } catch (e) {
    next(e);
  }
});

// What an extra project slot and an extra production slot cost (2026-10-21).
// Read-only, so no checkoutLimiter, like /production-pricing above.
router.get("/slot-pricing", authenticateVps, async (req, res, next) => {
  try {
    res.json({ ...(await readSlotPrices()), max_per_order: MAX_SLOTS_PER_ORDER });
  } catch (e) {
    next(e);
  }
});

// Extra slots (2026-10-21). Server-to-server, same trust boundary as
// /production-checkout. The caller states WHO and HOW MANY, never a price: the
// amount is computed here from slot_pricing, because the iPaymu account is
// shared and a VPS that could name its own price could charge anything.
router.post("/slot-checkout", checkoutLimiter, authenticateVps, async (req, res, next) => {
  try {
    const remoteUserId = Number.parseInt(req.body?.user_id, 10);
    const buyerEmail = String(req.body?.buyer_email || "").trim() || null;
    const projectQuantity = Number(req.body?.project_quantity ?? 0);
    const productionQuantity = Number(req.body?.production_quantity ?? 0);

    const validQuantity = (n) => Number.isInteger(n) && n >= 0 && n <= MAX_SLOTS_PER_ORDER;
    if (!remoteUserId || !validQuantity(projectQuantity) || !validQuantity(productionQuantity)) {
      return res.status(400).json({
        message: `user_id wajib diisi dan jumlah slot harus bilangan 0 sampai ${MAX_SLOTS_PER_ORDER}.`,
      });
    }
    if (projectQuantity + productionQuantity === 0) {
      return res.status(400).json({ message: "Pilih minimal satu slot untuk dibeli." });
    }

    const prices = await readSlotPrices();
    // A kind that is not for sale cannot be bought, however the request is built.
    if (projectQuantity > 0 && prices.project_slot_price <= 0) {
      return res.status(503).json({ message: "Slot project tambahan belum dijual." });
    }
    if (productionQuantity > 0 && prices.production_slot_price <= 0) {
      return res.status(503).json({ message: "Slot produksi tambahan belum dijual." });
    }

    const amount =
      projectQuantity * prices.project_slot_price +
      productionQuantity * prices.production_slot_price;
    if (!Number.isSafeInteger(amount) || amount <= 0 || amount > 100000000) {
      return res.status(400).json({ message: "Total pembelian di luar batas yang diizinkan." });
    }

    const referenceId = generateSlotReferenceId();
    const targetVps = req.targetVps;
    const returnBase = String(targetVps.base_url || "").replace(/\/+$/, "");
    const parts = [];
    if (projectQuantity) parts.push(`${projectQuantity} slot project`);
    if (productionQuantity) parts.push(`${productionQuantity} slot produksi`);

    const ipaymuResult = await createIpaymuRedirectPayment(req, {
      plan: {
        name: `Upgrade: ${parts.join(" + ")}`,
        initial_price: amount,
        description: "Penambahan kuota project dan aplikasi produksi",
      },
      order: { reference_id: referenceId, amount },
      // Same placeholder phone as the other VPS-side checkouts: iPaymu rejects an
      // empty buyerPhone and reports it as an unauthorized signature.
      buyer: {
        name: `User #${remoteUserId}`,
        email:
          buyerEmail || `user${remoteUserId}@${returnBase.replace(/^https?:\/\//, "")}`,
        phone: "081200000000",
      },
      overrideUrls: {
        returnUrl: `${returnBase}/studio/upgrade?slot_payment=success&ref=${encodeURIComponent(referenceId)}`,
        cancelUrl: `${returnBase}/studio/upgrade?slot_payment=cancel&ref=${encodeURIComponent(referenceId)}`,
      },
    });

    const order = await SlotOrder.create({
      reference_id: referenceId,
      target_vps_id: targetVps.id,
      remote_user_id: remoteUserId,
      buyer_email: buyerEmail,
      project_quantity: projectQuantity,
      production_quantity: productionQuantity,
      project_unit_price: prices.project_slot_price,
      production_unit_price: prices.production_slot_price,
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
      project_quantity: order.project_quantity,
      production_quantity: order.production_quantity,
    });
  } catch (e) {
    next(e);
  }
});

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
// authenticateVps). Writes Customer.password_hash directly so a failed save is reported to the caller
// (provisioning's upsertCustomerCredential swallows errors on purpose for the purchase flow).
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
    // create_if_missing (2026-10-24): the superadmin reset on the backend VPS sends this because an
    // account can exist there without a customers row here (the best-effort write in
    // upsertCustomerCredential can fail silently at purchase time). Without it the reset failed with
    // 404 and the account could never be recovered. The change-password route never sends it: it
    // verifies the current password first, which a missing row cannot satisfy.
    if (!customer && req.body?.create_if_missing !== true) {
      return res.status(404).json({ message: "Customer tidak ditemukan." });
    }

    // Written directly (not through upsertCustomerCredential, which swallows errors on purpose for the
    // purchase flow): the caller must hear about a failed save, or it would report a password that
    // does not work as changed.
    const password_hash = await hashPassword(newPassword);
    if (customer) {
      customer.password_hash = password_hash;
      await customer.save();
    } else {
      await Customer.create({
        target_vps_id: req.targetVps.id,
        email: String(req.body?.email || "").trim(),
        username,
        password_hash,
      });
    }
    res.json({ success: true, created: !customer });
  } catch (e) {
    next(e);
  }
});

// --- Checkout discounts (2026-09-10) ---
//
// Managed from the app-builder superadmin panel (VPS B), not the gateway's own
// admin CMS — the user asked for the setting to live there. authenticateVps is
// the same trust boundary the token/production checkout routes use: a valid
// X-Internal-Secret proves the caller is a registered backend VPS. Discounts
// are GLOBAL gateway config (the public checkout page is single), so unlike the
// checkout routes above these do NOT scope anything to req.targetVps.
//
// Price authority still lives here: the builder only ever states discount
// intent (percent/fixed, dates, scope); the actual charged amount is always
// recomputed on this side at checkout (src/routes/payments.js).

// Validates and normalizes a discount payload from the admin panel. Returns
// { error } for a bad request or { data } ready to write. Percent is capped at
// 90 and fixed floored at 1 on purpose: a discount that brings a price to zero
// cannot be charged through iPaymu (see the guard in payments.js) and is not
// what a promo is for.
function normalizeDiscountPayload(body) {
  const label = String(body?.label || "").trim();
  if (!label) return { error: "Nama diskon (label) wajib diisi." };

  const type = body?.type === "fixed" ? "fixed" : "percent";
  const value = Math.round(Number(body?.value));
  if (!Number.isFinite(value)) {
    return { error: "Nilai diskon wajib berupa angka." };
  }
  if (type === "percent" && (value < 1 || value > 90)) {
    return { error: "Diskon persen harus antara 1 dan 90." };
  }
  if (type === "fixed" && value < 1) {
    return { error: "Diskon nominal (rupiah) harus minimal 1." };
  }

  const appliesToAll = body?.applies_to_all !== false;
  let packagePlanIds = null;
  if (!appliesToAll) {
    const ids = Array.from(
      new Set(
        (Array.isArray(body?.package_plan_ids) ? body.package_plan_ids : [])
          .map((id) => Number.parseInt(id, 10))
          .filter((id) => Number.isInteger(id) && id > 0)
      )
    );
    if (ids.length === 0) {
      return {
        error: "Pilih minimal satu paket, atau setel diskon berlaku untuk semua paket.",
      };
    }
    packagePlanIds = ids;
  }

  // Empty string / null both mean "unset" for the date bounds.
  const parseDate = (raw) => {
    if (raw === undefined || raw === null || String(raw).trim() === "") return null;
    const d = new Date(raw);
    return Number.isFinite(d.getTime()) ? d : undefined; // undefined = invalid
  };
  const startsAt = parseDate(body?.starts_at);
  const endsAt = parseDate(body?.ends_at);
  if (startsAt === undefined) return { error: "Tanggal mulai tidak valid." };
  if (endsAt === undefined) return { error: "Tanggal berakhir tidak valid." };
  if (startsAt && endsAt && endsAt <= startsAt) {
    return { error: "Tanggal berakhir harus setelah tanggal mulai." };
  }

  const badgeText = String(body?.badge_text || "").trim() || null;

  return {
    data: {
      label,
      type,
      value,
      applies_to_all: appliesToAll,
      package_plan_ids: packagePlanIds,
      badge_text: badgeText,
      starts_at: startsAt,
      ends_at: endsAt,
      is_active: body?.is_active !== false,
    },
  };
}

// The package list the admin picker needs to choose "specific packages".
// Includes inactive plans so a discount can be prepared before a plan goes
// live, but marks them so the UI can show it.
router.get("/packages", authenticateVps, async (req, res, next) => {
  try {
    const plans = await PackagePlan.findAll({
      order: [["sort_order", "ASC"]],
      attributes: ["id", "name", "slug", "initial_price", "is_active"],
    });
    res.json({ data: plans });
  } catch (e) {
    next(e);
  }
});

router.get("/discounts", authenticateVps, async (req, res, next) => {
  try {
    const discounts = await Discount.findAll({ order: [["created_at", "DESC"]] });
    res.json({ data: discounts });
  } catch (e) {
    next(e);
  }
});

router.post("/discounts", authenticateVps, async (req, res, next) => {
  try {
    const { error, data } = normalizeDiscountPayload(req.body);
    if (error) return res.status(400).json({ message: error });
    const created = await Discount.create(data);
    res.status(201).json({ data: created });
  } catch (e) {
    next(e);
  }
});

router.put("/discounts/:id", authenticateVps, async (req, res, next) => {
  try {
    const discount = await Discount.findByPk(req.params.id);
    if (!discount) return res.status(404).json({ message: "Diskon tidak ditemukan." });
    const { error, data } = normalizeDiscountPayload(req.body);
    if (error) return res.status(400).json({ message: error });
    await discount.update(data);
    res.json({ data: discount });
  } catch (e) {
    next(e);
  }
});

router.delete("/discounts/:id", authenticateVps, async (req, res, next) => {
  try {
    const discount = await Discount.findByPk(req.params.id);
    if (!discount) return res.status(404).json({ message: "Diskon tidak ditemukan." });
    await discount.destroy();
    res.json({ success: true });
  } catch (e) {
    next(e);
  }
});

module.exports = router;
