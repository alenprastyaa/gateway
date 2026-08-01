const { DataTypes } = require("sequelize");
const sequelize = require("../config/database");

const PackagePlan = require("./PackagePlan")(sequelize, DataTypes);
const TargetVps = require("./TargetVps")(sequelize, DataTypes);
const PackageMapping = require("./PackageMapping")(sequelize, DataTypes);
const PaymentOrder = require("./PaymentOrder")(sequelize, DataTypes);
const AdminUser = require("./AdminUser")(sequelize, DataTypes);
const TokenPackage = require("./TokenPackage")(sequelize, DataTypes);
const TokenOrder = require("./TokenOrder")(sequelize, DataTypes);

// Explicit `as` aliases everywhere below: Sequelize's default alias guessing
// singularizes "TargetVps" to "TargetVp" (it treats the trailing "s" as a
// plural marker, which is wrong for this acronym), silently breaking any
// `include`-based access. Always name the alias explicitly instead of
// relying on the guess.
PackagePlan.hasMany(PackageMapping, { foreignKey: "package_plan_id", as: "packageMappings" });
PackageMapping.belongsTo(PackagePlan, { foreignKey: "package_plan_id", as: "packagePlan" });

TargetVps.hasMany(PackageMapping, { foreignKey: "target_vps_id", as: "packageMappings" });
PackageMapping.belongsTo(TargetVps, { foreignKey: "target_vps_id", as: "targetVps" });

PackagePlan.hasMany(PaymentOrder, { foreignKey: "package_plan_id", as: "paymentOrders" });
PaymentOrder.belongsTo(PackagePlan, { foreignKey: "package_plan_id", as: "packagePlan" });

TargetVps.hasMany(PaymentOrder, { foreignKey: "target_vps_id", as: "paymentOrders" });
PaymentOrder.belongsTo(TargetVps, { foreignKey: "target_vps_id", as: "targetVps" });

TokenPackage.hasMany(TokenOrder, { foreignKey: "token_package_id", as: "tokenOrders" });
TokenOrder.belongsTo(TokenPackage, { foreignKey: "token_package_id", as: "tokenPackage" });

TargetVps.hasMany(TokenOrder, { foreignKey: "target_vps_id", as: "tokenOrders" });
TokenOrder.belongsTo(TargetVps, { foreignKey: "target_vps_id", as: "targetVps" });

module.exports = {
  sequelize,
  PackagePlan,
  TargetVps,
  PackageMapping,
  PaymentOrder,
  AdminUser,
  TokenPackage,
  TokenOrder,
};
