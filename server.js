const env = require("./src/config/env");
const express = require("express");
const path = require("path");
const cors = require("cors");
const { sequelize, AdminUser } = require("./src/models");
const { hashPassword } = require("./src/lib/auth");
const publicRoutes = require("./src/routes/public");
const paymentRoutes = require("./src/routes/payments");
const adminAuthRoutes = require("./src/routes/admin/auth");
const adminTargetVpsRoutes = require("./src/routes/admin/targetVps");
const adminPackagesRoutes = require("./src/routes/admin/packages");
const adminOrdersRoutes = require("./src/routes/admin/orders");
const errorHandler = require("./src/middleware/errorHandler");
const { reconcileUserCounts } = require("./src/jobs/reconcileUserCounts");

const app = express();
// Runs behind nginx, which sets X-Forwarded-For — without this,
// express-rate-limit (used on the checkout endpoint) throws
// ERR_ERL_UNEXPECTED_X_FORWARDED_FOR on every request.
app.set("trust proxy", 1);

app.use(cors());
app.use(express.json());
// iPaymu can send payment notifications using either the current JSON
// callback format or the legacy application/x-www-form-urlencoded format.
// Accept both so a successful payment is not left pending merely because of
// the callback format selected in the merchant dashboard.
app.use(express.urlencoded({ extended: false }));
app.use(express.static(path.join(__dirname, "public")));

app.use("/api/public", publicRoutes);
app.use("/api/payments", paymentRoutes);
app.use("/api/admin", adminAuthRoutes);
app.use("/api/admin/target-vps", adminTargetVpsRoutes);
app.use("/api/admin/packages", adminPackagesRoutes);
app.use("/api/admin/orders", adminOrdersRoutes);

app.use(errorHandler);

async function ensureDefaultAdmin() {
  const existingCount = await AdminUser.count();
  if (existingCount > 0) return;

  const username = process.env.DEFAULT_ADMIN_USERNAME || "admin";
  const password = process.env.DEFAULT_ADMIN_PASSWORD || "06081999";
  await AdminUser.create({
    username,
    password_hash: await hashPassword(password),
    role: "superadmin",
  });
  console.log(
    `[setup] Belum ada akun admin — dibuat otomatis: username="${username}" password="${password}". Segera ganti password lewat menu Akun di CMS.`
  );
}

async function start() {
  await sequelize.authenticate();
  console.log(`[db] connected to ${env.DB_NAME}@${env.DB_HOST}`);

  await sequelize.sync();
  console.log("[db] schema sync selesai (tabel dibuat otomatis jika belum ada)");

  await ensureDefaultAdmin();

  app.listen(env.PORT, () => {
    console.log(`[server] tiktok-landing-gateway listening on port ${env.PORT}`);
  });

  const RECONCILE_INTERVAL_MS = 45 * 60 * 1000;
  setInterval(() => {
    reconcileUserCounts().catch((e) => console.error("[reconcile] failed", e));
  }, RECONCILE_INTERVAL_MS);
}

start().catch((e) => {
  console.error("Failed to start server:", e);
  process.exit(1);
});
