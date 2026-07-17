module.exports = (sequelize, DataTypes) => {
  const PackageMapping = sequelize.define(
    "PackageMapping",
    {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
      package_plan_id: { type: DataTypes.INTEGER, allowNull: false },
      target_vps_id: { type: DataTypes.INTEGER, allowNull: false },
      remote_package_id: { type: DataTypes.INTEGER, allowNull: false },
    },
    {
      tableName: "package_mappings",
      underscored: true,
      indexes: [
        {
          unique: true,
          fields: ["package_plan_id", "target_vps_id"],
        },
      ],
    }
  );

  return PackageMapping;
};
