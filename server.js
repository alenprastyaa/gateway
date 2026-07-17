const env = require("./src/config/env");
const express = require("express");
const path = require("path");
const cors = require("cors");
const { sequelize } = require("./src/models");
const publicRoutes = require("./src/routes/public");
const paymentRoutes = require("./src/routes/payments");
const adminAuthRoutes = require("./src/routes/admin/auth");
const adminTargetVpsRoutes = require("./src/routes/admin/targetVps");
const adminPackagesRoutes = require("./src/routes/admin/packages");
const adminOrdersRoutes = require("./src/routes/admin/orders");
const errorHandler = require("./src/middleware/errorHandler");
const { reconcileUserCounts } = require("./src/jobs/reconcileUserCounts");

const app = express();

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

app.use("/api/public", publicRoutes);
app.use("/api/payments", paymentRoutes);
app.use("/api/admin", adminAuthRoutes);
app.use("/api/admin/target-vps", adminTargetVpsRoutes);
app.use("/api/admin/packages", adminPackagesRoutes);
app.use("/api/admin/orders", adminOrdersRoutes);

app.use(errorHandler);

async function start() {
  await sequelize.authenticate();
  console.log(`[db] connected to ${env.DB_NAME}@${env.DB_HOST}`);

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
