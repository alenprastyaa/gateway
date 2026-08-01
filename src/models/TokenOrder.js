module.exports = (sequelize, DataTypes) => {
  const TokenOrder = sequelize.define(
    "TokenOrder",
    {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
      reference_id: { type: DataTypes.STRING, allowNull: false, unique: true },
      token_package_id: { type: DataTypes.INTEGER, allowNull: false },
      target_vps_id: { type: DataTypes.INTEGER, allowNull: false },
      remote_user_id: { type: DataTypes.INTEGER, allowNull: false },
      buyer_email: { type: DataTypes.STRING, allowNull: true },
      amount: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
      token_amount: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
      status: {
        type: DataTypes.ENUM("pending", "paid", "expired", "failed"),
        allowNull: false,
        defaultValue: "pending",
      },
      ipaymu_session_id: { type: DataTypes.STRING, allowNull: true },
      ipaymu_payment_url: { type: DataTypes.STRING, allowNull: true },
      ipaymu_response: { type: DataTypes.JSON, allowNull: true },
      callback_payloads: { type: DataTypes.JSON, allowNull: false, defaultValue: [] },
      credit_status: {
        type: DataTypes.ENUM("not_started", "pending", "succeeded", "failed"),
        allowNull: false,
        defaultValue: "not_started",
      },
      credit_attempts: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
      credit_last_error: { type: DataTypes.TEXT, allowNull: true },
      credited_at: { type: DataTypes.DATE, allowNull: true },
    },
    {
      tableName: "token_orders",
      underscored: true,
    }
  );

  return TokenOrder;
};
