// Per-project production billing (2026-09-05): the price row and the orders
// that pay for production years on a backend VPS.
module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.createTable("production_pricing", {
      id: { type: Sequelize.INTEGER, primaryKey: true, autoIncrement: true },
      yearly_price: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 150000 },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.NOW },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.NOW },
    });

    // Seed the single row this table will ever have. Without it the first
    // checkout would find nothing and either crash or fall back to a made-up
    // number — and a made-up number here is a real charge to a real customer.
    await queryInterface.bulkInsert("production_pricing", [
      {
        id: 1,
        yearly_price: 150000,
        created_at: new Date(),
        updated_at: new Date(),
      },
    ]);

    await queryInterface.createTable("production_orders", {
      id: { type: Sequelize.INTEGER, primaryKey: true, autoIncrement: true },
      reference_id: { type: Sequelize.STRING, allowNull: false, unique: true },
      target_vps_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: { model: "target_vps", key: "id" },
      },
      remote_user_id: { type: Sequelize.INTEGER, allowNull: false },
      buyer_email: { type: Sequelize.STRING, allowNull: true },
      remote_project_ids: { type: Sequelize.JSON, allowNull: false },
      project_count: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
      unit_price: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
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
      extend_status: {
        type: Sequelize.ENUM("not_started", "pending", "succeeded", "failed"),
        allowNull: false,
        defaultValue: "not_started",
      },
      extend_attempts: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
      extend_last_error: { type: Sequelize.TEXT, allowNull: true },
      extended_at: { type: Sequelize.DATE, allowNull: true },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.NOW },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.NOW },
    });

    // The webhook looks every order up by reference_id, and the admin list
    // filters by status. reference_id is already unique (indexed by that
    // constraint); this covers the other one.
    await queryInterface.addIndex("production_orders", ["status"], {
      name: "production_orders_status",
    });
  },

  down: async (queryInterface) => {
    await queryInterface.dropTable("production_orders");
    await queryInterface.dropTable("production_pricing");
  },
};
