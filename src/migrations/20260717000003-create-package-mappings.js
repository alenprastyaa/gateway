module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.createTable("package_mappings", {
      id: { type: Sequelize.INTEGER, primaryKey: true, autoIncrement: true },
      package_plan_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: { model: "package_plans", key: "id" },
        onDelete: "CASCADE",
      },
      target_vps_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: { model: "target_vps", key: "id" },
        onDelete: "CASCADE",
      },
      remote_package_id: { type: Sequelize.INTEGER, allowNull: false },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.NOW },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.NOW },
    });
    await queryInterface.addIndex("package_mappings", ["package_plan_id", "target_vps_id"], {
      unique: true,
      name: "package_mappings_plan_vps_unique",
    });
  },
  down: async (queryInterface) => {
    await queryInterface.dropTable("package_mappings");
  },
};
