module.exports = (sequelize, DataTypes) => {
  const PackagePlan = sequelize.define(
    "PackagePlan",
    {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
      name: { type: DataTypes.STRING, allowNull: false },
      slug: { type: DataTypes.STRING, allowNull: false, unique: true },
      description: { type: DataTypes.TEXT, allowNull: true },
      initial_price: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
      renewal_price: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
      max_projects: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 3 },
      features: { type: DataTypes.JSON, allowNull: true },
      is_active: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
      sort_order: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    },
    {
      tableName: "package_plans",
      underscored: true,
    }
  );

  return PackagePlan;
};
