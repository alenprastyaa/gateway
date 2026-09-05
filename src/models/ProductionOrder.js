// One payment for one or more production-app years (2026-09-05).
//
// Deliberately shaped after TokenOrder rather than PaymentOrder: like a token
// top-up and unlike a registration, the customer already exists on a known
// backend VPS, so there is no buyer to provision and nothing to create — just
// a balance-like thing to extend once the money lands.
//
// remote_project_ids is a JSON ARRAY because a renewal covers whichever
// projects the customer ticked, charged as one transaction. That was an
// explicit requirement ("user bisa memilih mana saja yang mau di perpanjang",
// paid together), and it is why this is not one order per project: three
// separate iPaymu checkouts for three apps would mean three payment fees and
// three chances to abandon the flow halfway.
module.exports = (sequelize, DataTypes) => {
  const ProductionOrder = sequelize.define(
    "ProductionOrder",
    {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
      reference_id: { type: DataTypes.STRING, allowNull: false, unique: true },
      target_vps_id: { type: DataTypes.INTEGER, allowNull: false },
      remote_user_id: { type: DataTypes.INTEGER, allowNull: false },
      buyer_email: { type: DataTypes.STRING, allowNull: true },
      // Project ids on the backend VPS. Not a foreign key to anything here —
      // the gateway has no projects table and no business having one.
      remote_project_ids: { type: DataTypes.JSON, allowNull: false, defaultValue: [] },
      // Recorded as they were at checkout, so the order stays readable after
      // someone edits the price: amount = project_count * unit_price.
      project_count: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
      unit_price: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
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
      // The retry ledger, same three columns TokenOrder uses. extend_status
      // is the gate that stops a webhook retry from granting a second year
      // after the first extension already succeeded.
      extend_status: {
        type: DataTypes.ENUM("not_started", "pending", "succeeded", "failed"),
        allowNull: false,
        defaultValue: "not_started",
      },
      extend_attempts: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
      extend_last_error: { type: DataTypes.TEXT, allowNull: true },
      extended_at: { type: DataTypes.DATE, allowNull: true },
    },
    {
      tableName: "production_orders",
      underscored: true,
    }
  );

  return ProductionOrder;
};
