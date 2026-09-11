module.exports = (sequelize, DataTypes) => {
  const AdminUser = sequelize.define(
    "AdminUser",
    {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
      username: { type: DataTypes.STRING, allowNull: false, unique: true },
      email: { type: DataTypes.STRING, allowNull: true },
      password_hash: { type: DataTypes.STRING, allowNull: false },
      role: { type: DataTypes.STRING, allowNull: false, defaultValue: "superadmin" },
      // Brute-force lockout (2026-09-11). failed_attempts counts CONSECUTIVE
      // failures (reset to 0 on any success); once it hits the threshold the
      // account is locked until locked_until. last_failed_ip/device record the
      // most recent failing source for forensics — never used as a control.
      failed_attempts: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
      locked_until: { type: DataTypes.DATE, allowNull: true },
      last_failed_ip: { type: DataTypes.STRING, allowNull: true },
      last_failed_device: { type: DataTypes.STRING, allowNull: true },
    },
    {
      tableName: "admin_users",
      underscored: true,
    }
  );

  return AdminUser;
};
