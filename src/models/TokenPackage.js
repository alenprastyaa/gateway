module.exports = (sequelize, DataTypes) => {
  const TokenPackage = sequelize.define(
    "TokenPackage",
    {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
      name: { type: DataTypes.STRING, allowNull: false },
      description: { type: DataTypes.TEXT, allowNull: true },
      price: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
      token_amount: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
      is_active: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
      sort_order: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    },
    {
      tableName: "token_packages",
      underscored: true,
    }
  );

  return TokenPackage;
};
