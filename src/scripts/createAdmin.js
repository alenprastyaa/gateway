// One-off CLI bootstrap for the first CMS admin account (there is no public
// admin registration endpoint by design).
// Usage: node src/scripts/createAdmin.js <username> <password> [email]

const { AdminUser, sequelize } = require("../models");
const { hashPassword } = require("../lib/auth");

async function main() {
  const [username, password, email] = process.argv.slice(2);
  if (!username || !password) {
    console.error("Usage: node src/scripts/createAdmin.js <username> <password> [email]");
    process.exit(1);
  }
  if (password.length < 8) {
    console.error("Password must be at least 8 characters.");
    process.exit(1);
  }

  await sequelize.authenticate();
  const existing = await AdminUser.findOne({ where: { username } });
  if (existing) {
    console.error(`Admin user "${username}" already exists.`);
    process.exit(1);
  }

  const admin = await AdminUser.create({
    username,
    email: email || null,
    password_hash: await hashPassword(password),
    role: "superadmin",
  });

  console.log(`Created admin user "${admin.username}" (id=${admin.id}).`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
