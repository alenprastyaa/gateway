const express = require("express");
const { AdminUser } = require("../../models");
const { verifyPassword, issueToken } = require("../../lib/auth");

const router = express.Router();

router.post("/login", async (req, res, next) => {
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

module.exports = router;
