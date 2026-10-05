const path = require("node:path");
const fs = require("node:fs");
const crypto = require("node:crypto");
require("dotenv").config({ path: path.resolve(__dirname, "../../.env") });
const backendDir = path.resolve(__dirname, "../..");
function loadConfig(overrides = {}) {
  const production =
    process.env.NODE_ENV === "production" || !!process.env.VERCEL;
  let secret = process.env.JWT_SECRET;
  if (!production && (!secret || secret === "parking_secret_key_2026_secure")) {
    const file = path.join(backendDir, ".dev-secrets.json");
    if (!fs.existsSync(file))
      fs.writeFileSync(
        file,
        JSON.stringify({ jwtSecret: crypto.randomBytes(48).toString("hex") }),
        { mode: 0o600, flag: "wx" },
      );
    secret = JSON.parse(fs.readFileSync(file, "utf8")).jwtSecret;
  }
  const config = {
    production,
    port: Number(process.env.PORT || 5050),
    jwtSecret: secret,
    jwtExpiresIn: process.env.JWT_EXPIRES_IN || "24h",
    mongoUri: process.env.MONGO_URI,
    maintenanceSecret: process.env.MAINTENANCE_SECRET,
    origins: (process.env.CORS_ORIGINS || "http://localhost:3000")
      .split(",")
      .map((x) => x.trim())
      .filter(Boolean),
    ...overrides,
  };
  if (
    !config.jwtSecret ||
    config.jwtSecret.length < 32 ||
    config.jwtSecret === "parking_secret_key_2026_secure"
  )
    throw new Error(
      "JWT_SECRET must be a private secret of at least 32 characters",
    );
  if (!Number.isInteger(config.port) || config.port < 1 || config.port > 65535)
    throw new Error("PORT must be between 1 and 65535");
  if (config.production && !config.mongoUri)
    throw new Error("MONGO_URI is required in deployment");
  if (
    config.production &&
    (!config.maintenanceSecret ||
      config.maintenanceSecret.length < 32 ||
      config.maintenanceSecret === config.jwtSecret)
  )
    throw new Error(
      "Deployment requires a separate MAINTENANCE_SECRET of at least 32 characters",
    );
  if (
    config.production &&
    (!process.env.CORS_ORIGINS || config.origins.includes("*"))
  )
    throw new Error("Configure explicit CORS_ORIGINS for deployment");
  return config;
}
module.exports = { loadConfig, backendDir };
