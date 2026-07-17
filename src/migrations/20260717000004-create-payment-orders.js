module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.createTable("payment_orders", {
      id: { type: Sequelize.INTEGER, primaryKey: true, autoIncrement: true },
      reference_id: { type: Sequelize.STRING, allowNull: false, unique: true },
      package_plan_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: { model: "package_plans", key: "id" },
      },
      buyer_name: { type: Sequelize.STRING, allowNull: false },
      buyer_email: { type: Sequelize.STRING, allowNull: false },
      buyer_phone: { type: Sequelize.STRING, allowNull: true },
      amount: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
      status: {
        type: Sequelize.ENUM("pending", "paid", "expired", "failed"),
        allowNull: false,
        defaultValue: "pending",
      },
      ipaymu_session_id: { type: Sequelize.STRING, allowNull: true },
      ipaymu_payment_url: { type: Sequelize.STRING, allowNull: true },
      ipaymu_response: { type: Sequelize.JSON, allowNull: true },
      callback_payloads: { type: Sequelize.JSON, allowNull: false },
      target_vps_id: {
        type: Sequelize.INTEGER,
        allowNull: true,
        references: { model: "target_vps", key: "id" },
      },
      remote_package_id: { type: Sequelize.INTEGER, allowNull: true },
      provisioning_status: {
        type: Sequelize.ENUM("not_started", "pending", "succeeded", "failed"),
        allowNull: false,
        defaultValue: "not_started",
      },
      provisioning_attempts: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
      provisioning_last_error: { type: Sequelize.TEXT, allowNull: true },
      remote_user_id: { type: Sequelize.INTEGER, allowNull: true },
      remote_username: { type: Sequelize.STRING, allowNull: true },
      provisioned_at: { type: Sequelize.DATE, allowNull: true },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.NOW },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.NOW },
    });
  },
  down: async (queryInterface) => {
    await queryInterface.dropTable("payment_orders");
  },
};
