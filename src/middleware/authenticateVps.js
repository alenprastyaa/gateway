const crypto = require("crypto");
const { TargetVps } = require("../models");
const { decryptSecret } = require("../lib/crypto");

// Identifies which registered backend VPS is calling by reverse-matching the
// X-Internal-Secret header against every TargetVps's decrypted secret — the
// same shared secret already used in the other direction (gateway -> VPS
// provisioning calls), so no new credential needs to be issued. Linear scan
// is fine: the number of registered VPS entries is small (a handful at most).
module.exports = async function authenticateVps(req, res, next) {
  const provided = String(req.headers["x-internal-secret"] || "");
  if (!provided) {
    return res.status(401).json({ message: "X-Internal-Secret header wajib diisi." });
  }
  const providedBuf = Buffer.from(provided);

  try {
    const targets = await TargetVps.findAll();
    for (const targetVps of targets) {
      let secret;
      try {
        secret = decryptSecret(targetVps.internal_secret_encrypted);
      } catch (e) {
        continue;
      }
      const secretBuf = Buffer.from(secret);
      if (
        secretBuf.length === providedBuf.length &&
        crypto.timingSafeEqual(secretBuf, providedBuf)
      ) {
        req.targetVps = targetVps;
        return next();
      }
    }
    return res.status(401).json({ message: "X-Internal-Secret tidak cocok dengan VPS manapun." });
  } catch (e) {
    return next(e);
  }
};
