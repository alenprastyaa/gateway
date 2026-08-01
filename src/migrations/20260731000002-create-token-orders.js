module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.createTable("token_orders", {
      id: { type: Sequelize.INTEGER, primaryKey: true, autoIncrement: true },
      reference_id: { type: Sequelize.STRING, allowNull: false, unique: true },
      token_package_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: { model: "token_packages", key: "id" },
      },
      target_vps_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: { model: "target_vps", key: "id" },
      },
      // The tiktok-bisnis User.id on that target VPS whose balance gets
      // credited — this order type is always for an already-logged-in user,
      // never an anonymous buyer, so there's no registration/renewal split.
      remote_user_id: { type: Sequelize.INTEGER, allowNull: false },
      buyer_email: { type: Sequelize.STRING, allowNull: true },
      amount: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
      token_amount: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
      status: {
        type: Sequelize.ENUM("pending", "paid", "expired", "failed"),
        allowNull: false,
        defaultValue: "pending",
      },
      ipaymu_session_id: { type: Sequelize.STRING, allowNull: true },
      ipaymu_payment_url: { type: Sequelize.STRING, allowNull: true },
      ipaymu_response: { type: Sequelize.JSON, allowNull: true },
      callback_payloads: { type: Sequelize.JSON, allowNull: false },
      credit_status: {
        type: Sequelize.ENUM("not_started", "pending", "succeeded", "failed"),
        allowNull: false,
        defaultValue: "not_started",
      },
      credit_attempts: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
      credit_last_error: { type: Sequelize.TEXT, allowNull: true },
      credited_at: { type: Sequelize.DATE, allowNull: true },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.NOW },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.NOW },
    });
  },
  down: async (queryInterface) => {
    await queryInterface.dropTable("token_orders");
  },
};
