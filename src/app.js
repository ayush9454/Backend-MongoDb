const express = require("express");
const cors = require("cors");
const crypto = require("node:crypto");
const mongoose = require("mongoose");
const routes = require("./routes");
const { ApiError, errorHandler, asyncRoute } = require("./middleware/errors");
function createApp(
  config,
  {
    connect = async () => {},
    ready = () => mongoose.connection.readyState === 1,
  } = {},
) {
  const app = express();
  app.disable("x-powered-by");
  app.use((req, res, next) => {
    req.id = crypto.randomUUID();
    res.set("X-Request-Id", req.id);
    res.set("X-Content-Type-Options", "nosniff");
    const started = Date.now();
    res.on("finish", () => {
      if (process.env.NODE_ENV !== "test")
        console.log(
          JSON.stringify({
            level: "info",
            requestId: req.id,
            method: req.method,
            path: req.path,
            status: res.statusCode,
            durationMs: Date.now() - started,
          }),
        );
    });
    next();
  });
  app.use(
    cors({
      origin: (origin, callback) =>
        callback(null, !origin || config.origins.includes(origin)),
      methods: ["GET", "POST", "OPTIONS"],
      allowedHeaders: ["Content-Type", "Authorization", "Idempotency-Key"],
    }),
  );
  app.use(express.json({ limit: "16kb" }));
  app.get("/health/live", (req, res) => res.json({ status: "ok" }));
  app.get(
    "/health/ready",
    asyncRoute(async (req, res) => {
      await connect();
      if (!ready())
        throw new ApiError(503, "NOT_READY", "Database is not ready");
      await mongoose.connection.db.admin().ping();
      res.json({ status: "ready" });
    }),
  );
  app.get(["/", "/api"], (req, res) =>
    res.json({ message: "Smart Parking API", version: 2 }),
  );
  app.use(
    "/api",
    asyncRoute(async (req, res, next) => {
      await connect();
      next();
    }),
    routes(config),
  );
  app.use((req, res, next) =>
    next(new ApiError(404, "NOT_FOUND", "Route not found")),
  );
  app.use(errorHandler);
  return app;
}
module.exports = { createApp };
