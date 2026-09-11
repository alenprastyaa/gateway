// Admin login brute-force lockout columns (2026-09-11).
module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.addColumn("admin_users", "failed_attempts", {
      type: Sequelize.INTEGER,
      allowNull: false,
      defaultValue: 0,
    });
    await queryInterface.addColumn("admin_users", "locked_until", {
      type: Sequelize.DATE,
      allowNull: true,
    });
    await queryInterface.addColumn("admin_users", "last_failed_ip", {
      type: Sequelize.STRING,
      allowNull: true,
    });
    await queryInterface.addColumn("admin_users", "last_failed_device", {
      type: Sequelize.STRING,
      allowNull: true,
    });
  },

  down: async (queryInterface) => {
    await queryInterface.removeColumn("admin_users", "failed_attempts");
    await queryInterface.removeColumn("admin_users", "locked_until");
    await queryInterface.removeColumn("admin_users", "last_failed_ip");
    await queryInterface.removeColumn("admin_users", "last_failed_device");
  },
};
