// What one production app costs for one year (2026-09-05).
//
// A SINGLE-ROW table, always id=1, seeded by its migration and only ever
// updated. It is a table rather than an env var or a constant so the price
// can be changed from the admin panel without a deploy, which is what was
// asked for.
//
// It lives on the GATEWAY and not on the backend VPS, for the same reason
// TokenPackage does: the iPaymu merchant account is shared between VPSes, so
// a VPS that could name its own prices could charge anything through someone
// else's account. Backend VPSes read this figure through
// /api/public/production-pricing and display it; the amount actually charged
// is computed here, from this row, and never taken from the request.
module.exports = (sequelize, DataTypes) => {
  const ProductionPricing = sequelize.define(
    "ProductionPricing",
    {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
      // Rupiah, whole units. INTEGER to match TokenPackage.price and
      // PaymentOrder.amount — money never becomes a float anywhere in this
      // codebase, and this is not the place to start.
      yearly_price: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 150000 },
    },
    {
      tableName: "production_pricing",
      underscored: true,
    }
  );

  return ProductionPricing;
};
