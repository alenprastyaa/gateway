const crypto = require("crypto");
const env = require("../config/env");

const ALGORITHM = "aes-256-gcm";

function encryptSecret(plaintext) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGORITHM, env.SECRET_ENCRYPTION_KEY, iv);
  const ciphertext = Buffer.concat([cipher.update(String(plaintext), "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `${iv.toString("hex")}:${authTag.toString("hex")}:${ciphertext.toString("hex")}`;
}

function decryptSecret(encoded) {
  const [ivHex, authTagHex, ciphertextHex] = String(encoded || "").split(":");
  if (!ivHex || !authTagHex || !ciphertextHex) {
    throw new Error("Format internal_secret_encrypted tidak valid.");
  }
  const decipher = crypto.createDecipheriv(
    ALGORITHM,
    env.SECRET_ENCRYPTION_KEY,
    Buffer.from(ivHex, "hex")
  );
  decipher.setAuthTag(Buffer.from(authTagHex, "hex"));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(ciphertextHex, "hex")),
    decipher.final(),
  ]);
  return plaintext.toString("utf8");
}

module.exports = { encryptSecret, decryptSecret };
