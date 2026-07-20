const path = require("path");
const Umzug = require("umzug");
const Sequelize = require("sequelize");
const { sequelize } = require("../models");

// Same storage table ("SequelizeMeta") and migrations dir that `npx
// sequelize-cli db:migrate` uses (see .sequelizerc) — running this in-process
// on every boot picks up right where manual CLI runs left off, and skips
// migrations that were already applied.
const umzug = new Umzug({
  storage: "sequelize",
  storageOptions: { sequelize },
  migrations: {
    params: [sequelize.getQueryInterface(), Sequelize],
    path: path.join(__dirname, "..", "migrations"),
    pattern: /\.js$/,
  },
  logging: (msg) => console.log(`[migrate] ${msg}`),
});

async function runPendingMigrations() {
  const pending = await umzug.pending();
  if (!pending.length) {
    console.log("[migrate] tidak ada migrasi tertunda.");
    return;
  }
  console.log(
    `[migrate] menjalankan ${pending.length} migrasi tertunda: ${pending
      .map((m) => m.file)
      .join(", ")}`
  );
  await umzug.up();
  console.log("[migrate] migrasi selesai.");
}

module.exports = { runPendingMigrations };
