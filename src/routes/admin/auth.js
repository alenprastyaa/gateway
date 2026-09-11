const express = require("express");
const rateLimit = require("express-rate-limit");
const { AdminUser } = require("../../models");
const { verifyPassword, issueToken, hashPassword } = require("../../lib/auth");
const authenticateAdmin = require("../../middleware/authenticateAdmin");
const { clientIp, deviceId } = require("../../lib/clientIp");

const router = express.Router();

// Consecutive failures before the account is locked, and for how long. Applies
// per USERNAME, so it stops a DISTRIBUTED brute force (many IPs against one
// account) that the per-IP limiter cannot see. Tradeoff: someone who knows the
// admin username can trigger a temporary lock (a 15-min DoS) on purpose — an
// acceptable price for a single-admin CMS, and far cheaper than an open door.
const LOCK_THRESHOLD = 5;
const LOCK_MINUTES = 15;

// Two independent per-source limiters, both stricter than the account lockout
// so a single source is stopped well before 5 attempts:
//   - by IP (unspoofable behind nginx): the hard ceiling.
//   - by device: catches one browser hopping across proxy IPs, which the IP
//     limiter misses. Device id is client-set (see lib/clientIp), so this is a
//     complementary layer, never the sole control.
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: clientIp,
  message: { message: "Terlalu banyak percobaan login. Coba lagi beberapa menit lagi." },
});

const loginDeviceLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: deviceId,
  message: { message: "Terlalu banyak percobaan login dari perangkat ini. Coba lagi beberapa menit lagi." },
});

router.post("/login", loginLimiter, loginDeviceLimiter, async (req, res, next) => {
  try {
    const username = String(req.body?.username || "").trim();
    const password = String(req.body?.password || "");
    if (!username || !password) {
      return res.status(400).json({ message: "Username dan password wajib diisi." });
    }

    const admin = await AdminUser.findOne({ where: { username } });

    // Account currently locked → refuse without even checking the password, so
    // a lock cannot be probed. 429 (not 401) so the client knows to wait.
    if (admin && admin.locked_until && new Date(admin.locked_until) > new Date()) {
      return res.status(429).json({
        message: "Akun terkunci sementara karena terlalu banyak percobaan gagal. Coba lagi nanti.",
      });
    }

    if (!admin || !(await verifyPassword(password, admin.password_hash))) {
      // Record the failure against the account (only when the username exists —
      // never reveal which usernames are real). Lock once the threshold is hit.
      if (admin) {
        admin.failed_attempts = (admin.failed_attempts || 0) + 1;
        admin.last_failed_ip = clientIp(req);
        admin.last_failed_device = deviceId(req);
        if (admin.failed_attempts >= LOCK_THRESHOLD) {
          admin.locked_until = new Date(Date.now() + LOCK_MINUTES * 60 * 1000);
          admin.failed_attempts = 0; // counter resets; the lock is the state now
        }
        await admin.save();
      }
      return res.status(401).json({ message: "Username atau password salah." });
    }

    // Success clears any accumulated failures / stale lock.
    if (admin.failed_attempts || admin.locked_until) {
      admin.failed_attempts = 0;
      admin.locked_until = null;
      await admin.save();
    }

    res.json({
      token: issueToken(admin),
      admin: { id: admin.id, username: admin.username, role: admin.role },
    });
  } catch (e) {
    next(e);
  }
});

router.put("/change-password", authenticateAdmin, async (req, res, next) => {
  try {
    const currentPassword = String(req.body?.current_password || "");
    const newPassword = String(req.body?.new_password || "");
    if (!currentPassword || !newPassword) {
      return res.status(400).json({ message: "Password lama dan password baru wajib diisi." });
    }
    if (newPassword.length < 8) {
      return res.status(400).json({ message: "Password baru minimal 8 karakter." });
    }

    const admin = await AdminUser.findByPk(req.admin.id);
    if (!admin || !(await verifyPassword(currentPassword, admin.password_hash))) {
      return res.status(401).json({ message: "Password lama tidak cocok." });
    }

    admin.password_hash = await hashPassword(newPassword);
    await admin.save();

    res.json({ success: true, message: "Password berhasil diubah." });
  } catch (e) {
    next(e);
  }
});

module.exports = router;
