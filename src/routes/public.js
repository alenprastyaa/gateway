const express = require("express");
const rateLimit = require("express-rate-limit");
const { PackagePlan, TokenPackage, ProductionPricing } = require("../models");
const { loadLiveDiscounts, pickBestDiscountForPlan } = require("../lib/discounts");
const { resolveReferralCode, reportReferralClick } = require("../lib/affiliate");
const { clientIp, deviceId } = require("../lib/clientIp");

const router = express.Router();

// Referral endpoints are reachable from a public page and each one costs a
// round trip to the backend VPS, so they get their own limiters — per real IP
// (unspoofable behind nginx) and per device, the same pair the checkout and
// login routes use. Generous enough for a visitor opening a link and reloading
// a few times, tight enough that these cannot be used to hammer the backend or
// to enumerate referral codes.
const referralLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: clientIp,
});
const referralDeviceLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: deviceId,
});

router.get("/packages", async (req, res, next) => {
  try {
    const plans = await PackagePlan.findAll({
      where: { is_active: true },
      order: [["sort_order", "ASC"]],
    });

    // Attach the live registration discount (if any) to each plan so the
    // checkout page can render the crossed-out price, the discounted price, a
    // badge and a countdown. One query for all plans, resolved per plan.
    const now = new Date();
    const liveDiscounts = await loadLiveDiscounts(now);
    const data = plans.map((plan) => {
      const json = plan.toJSON();
      json.discount = pickBestDiscountForPlan(plan, liveDiscounts, now);
      return json;
    });

    res.json({ data });
  } catch (e) {
    next(e);
  }
});

router.get("/token-packages", async (req, res, next) => {
  try {
    const packages = await TokenPackage.findAll({
      where: { is_active: true },
      order: [["sort_order", "ASC"]],
    });
    res.json({ data: packages });
  } catch (e) {
    next(e);
  }
});

// What a backend VPS quotes its customers for a production year (2026-09-05).
// Read-only and public for the same reason /token-packages is: it is a price
// list, and the figure a customer is about to be charged should be the figure
// they were shown. The amount actually charged is still computed on this side
// at checkout, never taken from a request.
router.get("/production-pricing", async (req, res, next) => {
  try {
    const row = await ProductionPricing.findByPk(1);
    res.json({ yearly_price: Number(row?.yearly_price) || 0 });
  } catch (e) {
    next(e);
  }
});

// --- Referral (2026-09-11) ---
//
// Both routes are thin proxies to the backend VPS. The gateway deliberately
// keeps no referral state of its own: a code it judged valid a minute ago is
// re-validated at payment time on the side that owns the graph, so nothing here
// can grant a commission.

// Confirms a code and returns the affiliate's MASKED name for the "you were
// invited by …" banner. An unknown code answers valid:false rather than an
// error — the checkout page must keep working for someone who mistyped a link.
router.get("/referral/resolve", referralLimiter, referralDeviceLimiter, async (req, res) => {
  const result = await resolveReferralCode(req.query?.code);
  if (!result) return res.json({ valid: false });
  res.json({
    valid: true,
    code: result.code,
    affiliate_name: result.affiliate_name,
    attribution_window_days: result.attribution_window_days,
  });
});

// Counts a link/QR open. Always answers 200: this runs while someone is trying
// to reach a checkout page, and an analytics failure must never surface to them.
router.post("/referral/click", referralLimiter, referralDeviceLimiter, async (req, res) => {
  await reportReferralClick({
    code: req.body?.code,
    ip: clientIp(req),
    deviceId: deviceId(req),
    source: req.body?.source,
  });
  res.json({ ok: true });
});

module.exports = router;
