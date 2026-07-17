module.exports = (sequelize, DataTypes) => {
  const PaymentOrder = sequelize.define(
    "PaymentOrder",
    {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
      reference_id: { type: DataTypes.STRING, allowNull: false, unique: true },
      package_plan_id: { type: DataTypes.INTEGER, allowNull: false },
      buyer_name: { type: DataTypes.STRING, allowNull: false },
      buyer_email: { type: DataTypes.STRING, allowNull: false },
      buyer_phone: { type: DataTypes.STRING, allowNull: true },
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
      // Snapshotted at checkout time so notify-time provisioning is deterministic
      // even if the admin changes the active target VPS in between.
      target_vps_id: { type: DataTypes.INTEGER, allowNull: true },
      remote_package_id: { type: DataTypes.INTEGER, allowNull: true },
      provisioning_status: {
        type: DataTypes.ENUM("not_started", "pending", "succeeded", "failed"),
        allowNull: false,
        defaultValue: "not_started",
      },
      provisioning_attempts: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
      provisioning_last_error: { type: DataTypes.TEXT, allowNull: true },
      remote_user_id: { type: DataTypes.INTEGER, allowNull: true },
      remote_username: { type: DataTypes.STRING, allowNull: true },
      provisioned_at: { type: DataTypes.DATE, allowNull: true },
    },
    {
      tableName: "payment_orders",
      underscored: true,
    }
  );

  return PaymentOrder;
};
