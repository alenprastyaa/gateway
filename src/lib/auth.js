const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const env = require("../config/env");

async function hashPassword(plainPassword) {
  return bcrypt.hash(plainPassword, 10);
}

async function verifyPassword(plainPassword, hash) {
  return bcrypt.compare(plainPassword, hash);
}

function issueToken(adminUser) {
  return jwt.sign(
    { id: adminUser.id, username: adminUser.username, role: adminUser.role },
    env.JWT_SECRET,
    { expiresIn: "12h" }
  );
}

function verifyToken(token) {
  return jwt.verify(token, env.JWT_SECRET);
}

module.exports = { hashPassword, verifyPassword, issueToken, verifyToken };
