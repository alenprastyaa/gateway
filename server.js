const env = require("./src/config/env");
const express = require("express");
const path = require("path");
const cors = require("cors");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const { clientIp } = require("./src/lib/clientIp");
const { sequelize, AdminUser } = require("./src/models");
const { hashPassword } = require("./src/lib/auth");
const publicRoutes = require("./src/routes/public");
const paymentRoutes = require("./src/routes/payments");
const vpsRoutes = require("./src/routes/vps");
const adminAuthRoutes = require("./src/routes/admin/auth");
const adminTargetVpsRoutes = require("./src/routes/admin/targetVps");
const adminPackagesRoutes = require("./src/routes/admin/packages");
const adminOrdersRoutes = require("./src/routes/admin/orders");
const adminTokenPackagesRoutes = require("./src/routes/admin/tokenPackages");
const adminTokenOrdersRoutes = require("./src/routes/admin/tokenOrders");
const adminProductionBillingRoutes = require("./src/routes/admin/productionBilling");
const errorHandler = require("./src/middleware/errorHandler");
const { reconcileUserCounts } = require("./src/jobs/reconcileUserCounts");
const { runPendingMigrations } = require("./src/lib/migrate");

const app = express();
// Runs behind nginx, which sets X-Forwarded-For — without this,
// express-rate-limit (used on the checkout endpoint) throws
// ERR_ERL_UNEXPECTED_X_FORWARDED_FOR on every request.
app.set("trust proxy", 1);

// Security headers (2026-09-10). Applied to every response, including the
// static checkout page and admin CMS.
//
// Two options are set deliberately, both to avoid affecting anything beyond
// this gateway:
//   - contentSecurityPolicy is OFF. The checkout page pulls Tailwind/fonts from
//     CDNs and the admin CMS runs inline scripts; a blind default CSP would
//     break the live page. A tuned per-page CSP is a separate, careful task.
//   - HSTS is scoped to the exact host (includeSubDomains: false). This VPS
//     also serves OTHER apps on sibling *.idschoolsystem.com subdomains; the
//     helmet default (includeSubDomains: true) would force HTTPS on all of
//     them and could break an app served over plain HTTP. This must stay false.
app.use(
  helmet({
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false,
    crossOriginResourcePolicy: { policy: "cross-origin" },
    hsts: { maxAge: 15552000, includeSubDomains: false },
  })
);

// Coarse global limiter for the API surface (2026-09-10) — a backstop against
// scraping/DoS on top of the tighter per-route limiters (login, checkout).
// Generous on purpose (an active admin session or post-payment status polling
// makes many calls); the sensitive endpoints keep their own strict limits.
// Keyed on the unspoofable X-Real-IP, same as the per-route limiters. Static
// assets are not under /api, so page loads are unaffected.
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 600,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: clientIp,
  message: { message: "Terlalu banyak permintaan. Coba lagi beberapa menit lagi." },
});

// The landing page and admin CMS are both served from this same origin, so
// they never need cross-origin access — this whitelist only matters for
// blocking arbitrary third-party sites from calling the API directly.
const ALLOWED_ORIGINS = [
  "https://checkout.applicationservice.id",
  "https://checkout.idschoolsystem.com",
  "https://lms.idschoolsystem.com",
];
const LOCALHOST_ORIGIN_PATTERN = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;
app.use(
  cors({
    origin(origin, callback) {
      if (!origin || ALLOWED_ORIGINS.includes(origin) || LOCALHOST_ORIGIN_PATTERN.test(origin)) {
        return callback(null, true);
      }
      callback(new Error("Not allowed by CORS"));
    },
  })
);
app.use(express.json());
// iPaymu can send payment notifications using either the current JSON
// callback format or the legacy application/x-www-form-urlencoded format.
// Accept both so a successful payment is not left pending merely because of
// the callback format selected in the merchant dashboard.
app.use(express.urlencoded({ extended: false }));
app.use(express.static(path.join(__dirname, "public")));

// Short referral link (2026-09-11): /r/<CODE> -> the checkout page with ?ref=.
//
// It exists for QR codes, where every character is a denser, harder-to-scan
// image — "/r/ABC12345" encodes far more reliably than the full query-string
// form, especially printed small or photographed at an angle.
//
// Redirect, not a rewrite, so the visitor's address bar shows the canonical
// checkout URL and a reload cannot re-trigger a click count. The code is
// shape-checked here only; validity is the backend's call.
app.get("/r/:code", (req, res) => {
  const raw = String(req.params.code || "").trim().toUpperCase();
  const safe = /^[A-Z0-9]{6,16}$/.test(raw) ? raw : "";
  if (!safe) return res.redirect(302, "/");
  res.redirect(302, `/?ref=${encodeURIComponent(safe)}#checkout`);
});

app.use("/api", apiLimiter);

app.use("/api/public", publicRoutes);
app.use("/api/payments", paymentRoutes);
app.use("/api/vps", vpsRoutes);
app.use("/api/admin", adminAuthRoutes);
app.use("/api/admin/target-vps", adminTargetVpsRoutes);
app.use("/api/admin/packages", adminPackagesRoutes);
app.use("/api/admin/orders", adminOrdersRoutes);
app.use("/api/admin/token-packages", adminTokenPackagesRoutes);
app.use("/api/admin/token-orders", adminTokenOrdersRoutes);
app.use("/api/admin/production", adminProductionBillingRoutes);

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

  // Runs on every boot so a `pm2 restart` alone is enough to apply new
  // migrations — no manual `npm run migrate` step needed. Fails fast (see
  // start().catch below) rather than let the server run against a
  // mismatched schema.
  await runPendingMigrations();

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
