require("dotenv").config();

const base = {
  username: process.env.DB_USER,
  password: process.env.DB_PASSWORD || null,
  database: process.env.DB_NAME,
  host: process.env.DB_HOST,
  port: Number.parseInt(process.env.DB_PORT, 10) || 3306,
  dialect: "mysql",
};

module.exports = {
  development: base,
  production: base,
};
