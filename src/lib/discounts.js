// Checkout discount resolution (2026-09-10). The single source of truth for
// "what does this package cost right now, and is there a promo on it" — used
// by BOTH the public /packages endpoint (display) and the checkout charge
// (src/routes/payments.js), so the price shown and the price charged are
// computed by the exact same code and cannot drift apart.
//
// Discounts only ever touch the REGISTRATION price (PackagePlan.initial_price).
const { Discount } = require("../models");

// A discount is live when it is active and `now` falls inside [starts_at,
// ends_at). Null bounds are open: no start = live immediately, no end = never
// expires. end is exclusive so a discount ending "2026-09-01T00:00:00" is gone
// at exactly midnight, not one tick after.
function isDiscountLiveNow(discount, now) {
  if (!discount.is_active) return false;
  const start = discount.starts_at ? new Date(discount.starts_at) : null;
  const end = discount.ends_at ? new Date(discount.ends_at) : null;
  if (start && Number.isFinite(start.getTime()) && now < start) return false;
  if (end && Number.isFinite(end.getTime()) && now >= end) return false;
  return true;
}

function discountAppliesToPlan(discount, planId) {
  if (discount.applies_to_all) return true;
  const ids = Array.isArray(discount.package_plan_ids) ? discount.package_plan_ids : [];
  return ids.map((id) => Number(id)).includes(Number(planId));
}

// The discounted registration price. Never below 0, always a whole rupiah.
// percent clamps value to 0..100; fixed subtracts a rupiah amount.
function computeDiscountedPrice(originalPrice, discount) {
  const price = Math.max(0, Math.round(Number(originalPrice) || 0));
  const value = Math.max(0, Math.round(Number(discount.value) || 0));
  if (price <= 0) return price;
  if (discount.type === "percent") {
    const pct = Math.min(100, value);
    return Math.max(0, Math.round((price * (100 - pct)) / 100));
  }
  return Math.max(0, price - value);
}

// Picks the discount that saves the buyer the MOST on this plan (a plan could
// match several — an all-packages promo and a package-specific one at once),
// and returns a flat, display-ready object, or null if nothing applies or the
// best saving is zero. `discounts` is a pre-filtered live list (see
// loadLiveDiscounts) so this stays synchronous and cheap to call per plan.
function pickBestDiscountForPlan(plan, discounts, now = new Date()) {
  const original = Math.max(0, Math.round(Number(plan.initial_price) || 0));
  if (original <= 0) return null; // "Hubungi admin" plans have no price to cut

  let best = null;
  let bestSaving = 0;
  for (const discount of discounts) {
    if (!isDiscountLiveNow(discount, now)) continue;
    if (!discountAppliesToPlan(discount, plan.id)) continue;
    const discounted = computeDiscountedPrice(original, discount);
    const saving = original - discounted;
    if (saving > bestSaving) {
      bestSaving = saving;
      best = discount;
    }
  }

  if (!best || bestSaving <= 0) return null;

  const discountedPrice = original - bestSaving;
  const percentOff = Math.round((bestSaving / original) * 100);
  return {
    id: best.id,
    label: best.label,
    type: best.type,
    value: best.value,
    // Always a badge: an admin custom string, else an auto "HEMAT X%" built
    // from the real saving (works for fixed-rupiah promos too).
    badge_text: best.badge_text || `HEMAT ${percentOff}%`,
    original_price: original,
    discounted_price: discountedPrice,
    amount_off: bestSaving,
    percent_off: percentOff,
    ends_at: best.ends_at || null,
  };
}

// Loads every discount that is live at `now`. One query, filtered in JS so the
// date-window logic lives in exactly one place (isDiscountLiveNow).
async function loadLiveDiscounts(now = new Date()) {
  const rows = await Discount.findAll({ where: { is_active: true } });
  return rows.filter((row) => isDiscountLiveNow(row, now));
}

// Convenience for the single-plan case (checkout): the best live discount for
// one plan, or null.
async function resolvePlanDiscount(plan, now = new Date()) {
  const live = await loadLiveDiscounts(now);
  return pickBestDiscountForPlan(plan, live, now);
}

module.exports = {
  isDiscountLiveNow,
  discountAppliesToPlan,
  computeDiscountedPrice,
  pickBestDiscountForPlan,
  loadLiveDiscounts,
  resolvePlanDiscount,
};
