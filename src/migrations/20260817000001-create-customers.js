module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.createTable("customers", {
      id: { type: Sequelize.INTEGER, primaryKey: true, autoIncrement: true },
      target_vps_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: { model: "target_vps", key: "id" },
      },
      email: { type: Sequelize.STRING, allowNull: false },
      username: { type: Sequelize.STRING, allowNull: false },
      password_hash: { type: Sequelize.STRING, allowNull: false },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.NOW },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.NOW },
    });
    await queryInterface.addIndex("customers", ["target_vps_id", "username"], {
      unique: true,
      name: "customers_target_vps_id_username_unique",
    });
  },
  down: async (queryInterface) => {
    await queryInterface.dropTable("customers");
  },
};
