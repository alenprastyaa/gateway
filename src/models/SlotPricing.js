// What one extra slot costs (2026-10-21): a project the account may create, and
// a production app the account may take live with its first year already paid.
//
// A SINGLE-ROW table, always id=1, for the same reasons ProductionPricing is:
// editable from the admin panel without a deploy, and it lives on the GATEWAY
// because the iPaymu merchant account is shared between VPSes - a backend that
// could name its own prices could charge anything through someone else's
// account.
//
// 0 means "not for sale". The migration seeds both at 0 on purpose: a made-up
// default here would be a real charge to a real customer, so selling a slot
// starts only after a superadmin has typed a price.
module.exports = (sequelize, DataTypes) => {
  const SlotPricing = sequelize.define(
    "SlotPricing",
    {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
      project_slot_price: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
      production_slot_price: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    },
    { tableName: "slot_pricing", underscored: true }
  );
  return SlotPricing;
};
