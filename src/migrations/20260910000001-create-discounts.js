// Checkout discounts (2026-09-10). Configured from the app-builder superadmin
// panel; applied on the public checkout page (display + charged amount).
module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.createTable("discounts", {
      id: { type: Sequelize.INTEGER, primaryKey: true, autoIncrement: true },
      label: { type: Sequelize.STRING, allowNull: false },
      type: {
        type: Sequelize.ENUM("percent", "fixed"),
        allowNull: false,
        defaultValue: "percent",
      },
      value: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
      applies_to_all: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: true },
      package_plan_ids: { type: Sequelize.JSON, allowNull: true },
      badge_text: { type: Sequelize.STRING, allowNull: true },
      starts_at: { type: Sequelize.DATE, allowNull: true },
      ends_at: { type: Sequelize.DATE, allowNull: true },
      is_active: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: true },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.NOW },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.NOW },
    });

    // The public /packages endpoint and every checkout load only the live
    // ones (is_active = true, still within the date window), so index the flag
    // it filters on.
    await queryInterface.addIndex("discounts", ["is_active"], {
      name: "discounts_is_active",
    });
  },

  down: async (queryInterface) => {
    await queryInterface.dropTable("discounts");
  },
};
