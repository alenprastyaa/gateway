require("dotenv").config();

const REQUIRED_VARS = [
  "DB_HOST",
  "DB_PORT",
  "DB_NAME",
  "DB_USER",
  "JWT_SECRET",
  "SECRET_ENCRYPTION_KEY",
  "IPAYMU_VA",
  "IPAYMU_API_KEY",
];

const missing = REQUIRED_VARS.filter((key) => !process.env[key]);
if (missing.length) {
  throw new Error(
    `Missing required environment variables: ${missing.join(", ")}. Copy .env.example to .env and fill them in.`
  );
}

const keyBuf = Buffer.from(process.env.SECRET_ENCRYPTION_KEY, "hex");
if (keyBuf.length !== 32) {
  throw new Error(
    "SECRET_ENCRYPTION_KEY must be a 32-byte value hex-encoded (64 hex characters)."
  );
}

module.exports = {
  PORT: Number.parseInt(process.env.PORT, 10) || 1300,
  DB_HOST: process.env.DB_HOST,
  DB_PORT: Number.parseInt(process.env.DB_PORT, 10) || 3306,
  DB_NAME: process.env.DB_NAME,
  DB_USER: process.env.DB_USER,
  DB_PASSWORD: process.env.DB_PASSWORD || "",
  PUBLIC_BASE_URL: (process.env.PUBLIC_BASE_URL || "").replace(/\/+$/, ""),
  IPAYMU_VA: process.env.IPAYMU_VA,
  IPAYMU_API_KEY: process.env.IPAYMU_API_KEY,
  IPAYMU_BASE_URL: (process.env.IPAYMU_BASE_URL || "https://my.ipaymu.com").replace(/\/+$/, ""),
  JWT_SECRET: process.env.JWT_SECRET,
  SECRET_ENCRYPTION_KEY: keyBuf,
};
