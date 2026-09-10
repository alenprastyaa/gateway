// Checkout discount (2026-09-10). A promotion the superadmin configures from
// the app-builder panel (VPS B, via /api/vps/discounts) that changes how the
// public checkout page prices registration.
//
// Scope: applies to ALL packages (applies_to_all=true) or to a hand-picked
// subset (applies_to_all=false + package_plan_ids). It only ever touches the
// REGISTRATION price (PackagePlan.initial_price) — the renewal_price is left
// alone on purpose (user decision 2026-09-10: "harga pendaftaran saja").
//
// The amount actually charged is recomputed server-side at checkout from this
// row (see src/routes/payments.js), never taken from the client — same price
// authority rule the rest of the gateway follows.
module.exports = (sequelize, DataTypes) => {
  const Discount = sequelize.define(
    "Discount",
    {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
      // Human name of the promo, e.g. "Promo Kemerdekaan". Shown to no one by
      // itself; the badge_text is what the buyer sees. Kept for the admin list.
      label: { type: DataTypes.STRING, allowNull: false },
      // percent -> value is 1..100; fixed -> value is a rupiah amount subtracted.
      type: {
        type: DataTypes.ENUM("percent", "fixed"),
        allowNull: false,
        defaultValue: "percent",
      },
      value: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
      // true: every active package. false: only the ids in package_plan_ids.
      applies_to_all: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
      // Array of PackagePlan ids, consulted only when applies_to_all is false.
      package_plan_ids: { type: DataTypes.JSON, allowNull: true },
      // Optional custom badge ("HEMAT SPESIAL"); when null the checkout builds
      // "HEMAT X%" from the computed saving so a badge always shows.
      badge_text: { type: DataTypes.STRING, allowNull: true },
      // Both nullable. starts_at null = live immediately; ends_at null = no
      // expiry (but the whole point of this feature is a deadline, so the UI
      // pushes the admin to set one). The window is [starts_at, ends_at).
      starts_at: { type: DataTypes.DATE, allowNull: true },
      ends_at: { type: DataTypes.DATE, allowNull: true },
      is_active: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
    },
    {
      tableName: "discounts",
      underscored: true,
    }
  );

  return Discount;
};
