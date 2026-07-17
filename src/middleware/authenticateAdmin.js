const { verifyToken } = require("../lib/auth");

module.exports = function authenticateAdmin(req, res, next) {
  const authHeader = req.headers["authorization"];
  const token = authHeader && authHeader.split(" ")[1];
  if (!token) {
    return res.status(401).json({ message: "Akses ditolak, token hilang" });
  }

  try {
    req.admin = verifyToken(token);
    next();
  } catch (e) {
    return res.status(403).json({ message: "Token tidak valid" });
  }
};
