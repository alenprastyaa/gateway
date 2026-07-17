module.exports = (sequelize, DataTypes) => {
  const TargetVps = sequelize.define(
    "TargetVps",
    {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
      name: { type: DataTypes.STRING, allowNull: false },
      base_url: { type: DataTypes.STRING, allowNull: false },
      // AES-256-GCM ciphertext, format "iv:authTag:ciphertext" (all hex). Never expose via any read API.
      internal_secret_encrypted: { type: DataTypes.TEXT, allowNull: false },
      priority: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
      quota: { type: DataTypes.INTEGER, allowNull: true },
      current_count: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
      status: {
        type: DataTypes.ENUM("active", "full", "disabled", "error"),
        allowNull: false,
        defaultValue: "disabled",
      },
      last_synced_count: { type: DataTypes.INTEGER, allowNull: true },
      last_synced_at: { type: DataTypes.DATE, allowNull: true },
      last_error: { type: DataTypes.TEXT, allowNull: true },
    },
    {
      tableName: "target_vps",
      underscored: true,
    }
  );

  return TargetVps;
};
