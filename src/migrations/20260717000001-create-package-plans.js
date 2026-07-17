module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.createTable("package_plans", {
      id: { type: Sequelize.INTEGER, primaryKey: true, autoIncrement: true },
      name: { type: Sequelize.STRING, allowNull: false },
      slug: { type: Sequelize.STRING, allowNull: false, unique: true },
      description: { type: Sequelize.TEXT, allowNull: true },
      initial_price: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
      renewal_price: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
      max_projects: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 3 },
      features: { type: Sequelize.JSON, allowNull: true },
      is_active: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: true },
      sort_order: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.NOW },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.NOW },
    });
  },
  down: async (queryInterface) => {
    await queryInterface.dropTable("package_plans");
  },
};
