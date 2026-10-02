// Affiliate referral capture (2026-09-11). The code a buyer arrived with,
// stored on the order so it survives the gap between checkout and the payment
// webhook (which can be minutes later, from a different device, after the
// browser cookie is long gone).
module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.addColumn("payment_orders", "referral_code", {
      type: Sequelize.STRING(32),
      allowNull: true,
    });

    // Admin lookups ("which orders came from this affiliate") and the
    // reconciliation query that pairs paid orders against commission events.
    await queryInterface.addIndex("payment_orders", ["referral_code"], {
      name: "payment_orders_referral_code",
    });
  },

  down: async (queryInterface) => {
    await queryInterface.removeIndex("payment_orders", "payment_orders_referral_code");
    await queryInterface.removeColumn("payment_orders", "referral_code");
  },
};
