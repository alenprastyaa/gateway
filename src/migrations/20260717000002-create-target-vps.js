module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.createTable("target_vps", {
      id: { type: Sequelize.INTEGER, primaryKey: true, autoIncrement: true },
      name: { type: Sequelize.STRING, allowNull: false },
      base_url: { type: Sequelize.STRING, allowNull: false },
      internal_secret_encrypted: { type: Sequelize.TEXT, allowNull: false },
      priority: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
      quota: { type: Sequelize.INTEGER, allowNull: true },
      current_count: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
      status: {
        type: Sequelize.ENUM("active", "full", "disabled", "error"),
        allowNull: false,
        defaultValue: "disabled",
      },
      last_synced_count: { type: Sequelize.INTEGER, allowNull: true },
      last_synced_at: { type: Sequelize.DATE, allowNull: true },
      last_error: { type: Sequelize.TEXT, allowNull: true },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.NOW },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.NOW },
    });
  },
  down: async (queryInterface) => {
    await queryInterface.dropTable("target_vps");
  },
};
