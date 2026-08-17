module.exports = (sequelize, DataTypes) => {
  const Customer = sequelize.define(
    "Customer",
    {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
      // Which backend VPS this credential belongs to — the gateway can
      // register more than one tiktok-bisnis instance (see TargetVps /
      // pickActiveTarget), and usernames are only unique WITHIN one
      // backend's own User table, not globally. Every lookup in
      // POST /api/vps/verify-login is scoped by (target_vps_id, username)
      // for exactly this reason.
      target_vps_id: { type: DataTypes.INTEGER, allowNull: false },
      email: { type: DataTypes.STRING, allowNull: false },
      username: { type: DataTypes.STRING, allowNull: false },
      // bcrypt hash (see src/lib/auth.js's hashPassword/verifyPassword) of
      // the SAME plaintext password the backend VPS itself generated and
      // emailed to the customer (src/lib/provisioning.js upserts this from
      // provision-paid-user/renew-paid-user's `password` response field) —
      // this is not a gateway-chosen password, just a second copy of the
      // one that already exists.
      password_hash: { type: DataTypes.STRING, allowNull: false },
    },
    {
      tableName: "customers",
      underscored: true,
    }
  );

  return Customer;
};
