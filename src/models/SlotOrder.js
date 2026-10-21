// One payment for extra slots on a backend VPS account (2026-10-21).
//
// Shaped after ProductionOrder: the customer already exists on a known VPS, so
// there is nothing to provision, only a quota to raise once the money lands.
// One order may buy both kinds at once (a quantity of 0 means "none of that
// kind"), so a customer pays one iPaymu fee, not two.
module.exports = (sequelize, DataTypes) => {
  const SlotOrder = sequelize.define(
    "SlotOrder",
    {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
      reference_id: { type: DataTypes.STRING, allowNull: false, unique: true },
      target_vps_id: { type: DataTypes.INTEGER, allowNull: false },
      remote_user_id: { type: DataTypes.INTEGER, allowNull: false },
      buyer_email: { type: DataTypes.STRING, allowNull: true },
      // Quantities and unit prices as they were at checkout, so the order stays
      // readable after someone edits the price:
      // amount = project_quantity * project_unit_price
      //        + production_quantity * production_unit_price
      project_quantity: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
      production_quantity: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
      project_unit_price: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
      production_unit_price: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
      amount: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
      status: {
        type: DataTypes.ENUM("pending", "paid", "expired", "failed"),
        allowNull: false,
        defaultValue: "pending",
      },
      ipaymu_session_id: { type: DataTypes.STRING, allowNull: true },
      ipaymu_payment_url: { type: DataTypes.STRING, allowNull: true },
      ipaymu_response: { type: DataTypes.JSON, allowNull: true },
      callback_payloads: { type: DataTypes.JSON, allowNull: false, defaultValue: [] },
      // The retry ledger, same columns ProductionOrder uses. grant_status is the
      // gate that stops a webhook retry from granting the slots twice once the
      // first grant succeeded.
      grant_status: {
        type: DataTypes.ENUM("not_started", "pending", "succeeded", "failed"),
        allowNull: false,
        defaultValue: "not_started",
      },
      grant_attempts: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
      grant_last_error: { type: DataTypes.TEXT, allowNull: true },
      granted_at: { type: DataTypes.DATE, allowNull: true },
    },
    { tableName: "slot_orders", underscored: true }
  );
  return SlotOrder;
};
