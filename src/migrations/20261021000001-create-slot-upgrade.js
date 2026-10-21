// Extra project / production slots (2026-10-21): the price row and the orders
// that pay for them.
module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.createTable("slot_pricing", {
      id: { type: Sequelize.INTEGER, primaryKey: true, autoIncrement: true },
      project_slot_price: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
      production_slot_price: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.NOW },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.NOW },
    });

    // Both prices start at 0 = not for sale. No default price is invented: a
    // made-up number here is a real charge, so selling starts when a superadmin
    // sets one.
    await queryInterface.bulkInsert("slot_pricing", [
      { id: 1, project_slot_price: 0, production_slot_price: 0, created_at: new Date(), updated_at: new Date() },
    ]);

    await queryInterface.createTable("slot_orders", {
      id: { type: Sequelize.INTEGER, primaryKey: true, autoIncrement: true },
      reference_id: { type: Sequelize.STRING, allowNull: false, unique: true },
      target_vps_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: { model: "target_vps", key: "id" },
      },
      remote_user_id: { type: Sequelize.INTEGER, allowNull: false },
      buyer_email: { type: Sequelize.STRING, allowNull: true },
      project_quantity: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
      production_quantity: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
      project_unit_price: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
      production_unit_price: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
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
      grant_status: {
        type: Sequelize.ENUM("not_started", "pending", "succeeded", "failed"),
        allowNull: false,
        defaultValue: "not_started",
      },
      grant_attempts: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
      grant_last_error: { type: Sequelize.TEXT, allowNull: true },
      granted_at: { type: Sequelize.DATE, allowNull: true },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.NOW },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.NOW },
    });
    await queryInterface.addIndex("slot_orders", ["status"], { name: "slot_orders_status" });
  },

  down: async (queryInterface) => {
    await queryInterface.dropTable("slot_orders");
    await queryInterface.dropTable("slot_pricing");
  },
};
