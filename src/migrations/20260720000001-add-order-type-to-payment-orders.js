module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.addColumn("payment_orders", "order_type", {
      type: Sequelize.ENUM("new_registration", "renewal"),
      allowNull: false,
      defaultValue: "new_registration",
    });
  },
  down: async (queryInterface) => {
    await queryInterface.removeColumn("payment_orders", "order_type");
  },
};
