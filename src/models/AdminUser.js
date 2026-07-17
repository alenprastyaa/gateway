module.exports = (sequelize, DataTypes) => {
  const AdminUser = sequelize.define(
    "AdminUser",
    {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
      username: { type: DataTypes.STRING, allowNull: false, unique: true },
      email: { type: DataTypes.STRING, allowNull: true },
      password_hash: { type: DataTypes.STRING, allowNull: false },
      role: { type: DataTypes.STRING, allowNull: false, defaultValue: "superadmin" },
    },
    {
      tableName: "admin_users",
      underscored: true,
    }
  );

  return AdminUser;
};
