const express = require("express");
const rateLimit = require("express-rate-limit");
const { AdminUser } = require("../../models");
const { verifyPassword, issueToken, hashPassword } = require("../../lib/auth");
const authenticateAdmin = require("../../middleware/authenticateAdmin");

const router = express.Router();

// Only the CMS admin ever hits this — 10 tries per 15 min per IP is plenty
// for a mistyped password, but stops a script from brute-forcing it.
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: "Terlalu banyak percobaan login. Coba lagi beberapa menit lagi." },
});

router.post("/login", loginLimiter, async (req, res, next) => {
  try {
    const username = String(req.body?.username || "").trim();
    const password = String(req.body?.password || "");
    if (!username || !password) {
      return res.status(400).json({ message: "Username dan password wajib diisi." });
    }

    const admin = await AdminUser.findOne({ where: { username } });
    if (!admin || !(await verifyPassword(password, admin.password_hash))) {
      return res.status(401).json({ message: "Username atau password salah." });
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
